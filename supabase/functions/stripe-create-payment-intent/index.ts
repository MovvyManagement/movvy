// =============================================================================
// POST /stripe-create-payment-intent   { booking_id: uuid }
// -----------------------------------------------------------------------------
// Creates a Stripe PaymentIntent so the customer can pay Movvy for their move.
// DIRECT charge into Movvy's own Stripe account — no Connect, no split (Adam
// pays crews their 80% manually off-platform; see migration 0058).
//
// Trust model: the amount is computed SERVER-SIDE from the booking row
// (actual_total_cents, the final timed bill — falling back to the estimate).
// The client never sends or influences the amount. RLS ensures the caller can
// only create an intent for a booking they own.
//
// Returns { client_secret, payment_intent_id, amount_cents, currency } for the
// React Native Payment Sheet. No secret ever reaches the client — only the
// short-lived client_secret, which is scoped to this one PaymentIntent.
//
// Idempotent: keyed on booking + amount, so a double-tap or retry reuses the
// same PaymentIntent instead of creating a second charge.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  checkRateLimit, httpError, HttpError, jsonResponse, requireAuth, userClient, adminClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  // Optional gratuity the customer chose, in cents. Validated + capped
  // server-side below so a client can't tip a negative or absurd amount.
  tip_cents: z.number().int().min(0).max(100000).optional(),
});

// Statuses at which it makes sense to collect payment. Movvy is "pay after the
// move", so payment is expected once the crew has finished (final amount known)
// — but we also allow an already-confirmed move with a set amount, for testing.
const PAYABLE_STATUSES = ['completed', 'unloading', 'in_transit'];

function form(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:stripe_pi`,
      endpoint: 'stripe-create-payment-intent',
      limit: 20, windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id } = parsed.data;

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) {
      // Fail closed: without the key we cannot charge. Don't pretend success.
      console.error('[stripe-create-payment-intent] STRIPE_SECRET_KEY unset');
      throw httpError(503, 'Payments are not configured yet.');
    }

    // RLS-bound client — the customer can only read their own booking.
    const supabase = userClient(req.headers.get('Authorization'));
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, short_code, status, payment_status, actual_total_cents, price_total_cents, stripe_payment_intent_id, customer_id')
      .eq('id', booking_id)
      .maybeSingle();

    if (error || !booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, 'Not your booking');
    if (booking.payment_status === 'captured') throw httpError(409, 'This move is already paid.');
    if (!PAYABLE_STATUSES.includes(booking.status)) {
      throw httpError(409, 'This move is not ready for payment yet.');
    }

    // SERVER-SIDE amount — final bill if known, else the estimate. Never trust
    // any client-supplied figure.
    const moveCents = booking.actual_total_cents ?? booking.price_total_cents;
    if (!moveCents || moveCents <= 0) throw httpError(409, 'No amount to charge on this move.');

    // Tip is 100% the crew's. Cap it at the move amount (or $1000) to stop
    // fat-finger / abuse, but otherwise honour the customer's choice. The
    // customer pays the move + tip in a single charge.
    const tipCents = Math.max(0, Math.min(parsed.data.tip_cents ?? 0, Math.min(moveCents, 100000)));
    const total = moveCents + tipCents;

    // Reuse/create a Stripe customer for this profile (service role — the
    // stripe_customer_id column isn't customer-writable).
    const admin = adminClient();
    let customerId: string | null = null;
    {
      const { data: prof } = await admin.from('profiles')
        .select('stripe_customer_id, full_name, email').eq('id', user.id).maybeSingle();
      customerId = (prof as any)?.stripe_customer_id ?? null;
      if (!customerId) {
        const cRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({
            name: (prof as any)?.full_name ?? '',
            email: (prof as any)?.email ?? '',
            'metadata[profile_id]': user.id,
          }),
        });
        if (cRes.ok) {
          customerId = (await cRes.json()).id;
          await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
        } else {
          console.error('[stripe-create-payment-intent] customer create failed', await cRes.text());
        }
      }
    }

    // Create the PaymentIntent. No `payment_method_types` (dynamic payment
    // methods, per Stripe best practice). Idempotency-Key keeps retries safe.
    const piParams: Record<string, string> = {
      amount: String(total),
      currency: 'cad',
      'automatic_payment_methods[enabled]': 'true',
      description: `Movvy move #${booking.short_code}`,
      'metadata[booking_id]': booking.id,
      'metadata[short_code]': booking.short_code ?? '',
      'metadata[customer_id]': user.id,
      'metadata[move_cents]': String(moveCents),
      'metadata[tip_cents]': String(tipCents),
    };
    if (customerId) piParams.customer = customerId;

    const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Key includes the total so changing the tip creates a fresh intent
        // rather than colliding with the prior amount.
        'Idempotency-Key': `movvy_pi_${booking.id}_${total}`,
      },
      body: form(piParams),
    });

    if (!piRes.ok) {
      const errText = await piRes.text();
      console.error('[stripe-create-payment-intent] PI create failed', piRes.status, errText);
      throw httpError(502, 'Could not start the payment. Please try again.');
    }
    const pi = await piRes.json();

    // Record the PI id on the booking now (payment_status stays 'uncharged'
    // until the webhook confirms 'captured' — the source of truth is Stripe).
    await admin.from('bookings')
      .update({ stripe_payment_intent_id: pi.id })
      .eq('id', booking.id);

    return jsonResponse({
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      amount_cents: total,      // what the customer is charged (move + tip)
      move_cents: moveCents,
      tip_cents: tipCents,
      currency: 'cad',
      customer_id: customerId,
    }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[stripe-create-payment-intent] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
