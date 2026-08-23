// =============================================================================
// admin-refund-booking
// -----------------------------------------------------------------------------
// Management-only STANDALONE refund for a booking (does NOT cancel the move).
//
// Contract:
//   POST { booking_id: string (uuid), amount_cents: int > 0, reason?: string }
//   -> 200 { ok: true, refunded_cents, refundable_remaining_cents, refund_id }
//   -> 4xx { error: string }
//
// Access: management only, resolved via movvy_admin_access() running as the
// caller so RLS and policy stay in effect.
//
// WHAT CHANGED, AND WHY IT MATTERED
// ---------------------------------
// This endpoint never worked. It read `bookings.refund_cents` — a column that
// lives on `disputes`, not on `bookings`. Postgres returned 42703, the error
// fell into the `if (bErr || !booking)` branch, and the console's Issue Refund
// button reported "Booking not found." for every booking that existed. The
// header also claimed Stripe wasn't connected and left the actual refund as a
// TODO, so even a fixed column would only have written a number while no money
// moved.
//
// Stripe IS connected. This now issues a real refund, and deliberately does NOT
// reintroduce a local refund_cents column: STRIPE is asked what is still
// refundable on the payment intent (amount_received minus amount_refunded).
// A local counter would be a second source of truth that drifts the first time
// a refund is issued from the Stripe dashboard, or a webhook is missed.
//
// Bookkeeping is left to the existing `charge.refunded` webhook branch, which
// already flips payment_status to refunded / partially_refunded and updates
// payments.refunded_cents. One writer, not two.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/security.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

Deno.serve(async (req: Request): Promise<Response> => {
  // corsHeaders is a per-request function in this project — resolve it once and
  // reuse for the preflight response AND every JSON response.
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Not authenticated.' }, 401);

  // Client bound to the caller's JWT so movvy_admin_access + RLS run as them.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // --- Validate input --------------------------------------------------------
  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch (_e) {
    return json({ error: 'Invalid request. Need booking_id + positive amount_cents.' }, 400);
  }

  // --- Gate: management only --------------------------------------------------
  const { data: tier, error: tierErr } = await supabase.rpc('movvy_admin_access');
  if (tierErr) return json({ error: 'Could not verify access.' }, 500);
  if (tier !== 'management') return json({ error: 'Refunds are management-only.' }, 403);

  // Rate limit AFTER the access check, so a failed probe by a non-admin can't
  // burn a real admin's budget, and keyed to the caller so one compromised
  // session can't drain the Stripe balance in a loop. 20/hour is far above
  // anything a human refunding by hand will hit — the console shows one button
  // per owed move — while still bounding the damage.
  const { data: me } = await supabase.auth.getUser();
  if (me?.user?.id) {
    try {
      await checkRateLimit({
        bucketKey: `user:${me.user.id}:admin_refund`,
        endpoint: 'admin-refund-booking',
        limit: 20, windowSeconds: 3600,
      });
    } catch {
      return json({ error: 'Too many refunds in the last hour. Try again shortly.' }, 429);
    }
  }

  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) return json({ error: 'Payments are not configured.' }, 503);

  // --- Load booking ----------------------------------------------------------
  // Distinguish "not found" from "the query broke", so a schema mistake can
  // never again present itself to an admin as a missing booking.
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(
      'id, short_code, status, payment_status, deposit_status, ' +
      'stripe_payment_intent_id, stripe_deposit_payment_intent_id',
    )
    .eq('id', input.booking_id)
    .maybeSingle();
  if (bErr) {
    console.error('[admin-refund-booking] booking lookup failed', bErr);
    return json({ error: 'Could not read that booking.' }, 500);
  }
  if (!booking) return json({ error: 'Booking not found.' }, 404);

  // Refund the FINAL payment when there is one, otherwise the deposit. A move
  // that was cancelled before completion has only ever taken a deposit.
  const piId: string | null =
    (booking as any).stripe_payment_intent_id ??
    (booking as any).stripe_deposit_payment_intent_id ??
    null;
  if (!piId) return json({ error: 'No payment on file to refund.' }, 409);

  // --- Ask Stripe what is still refundable -----------------------------------
  const piRes = await fetch(
    `https://api.stripe.com/v1/payment_intents/${piId}?expand[]=latest_charge`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (!piRes.ok) {
    console.error('[admin-refund-booking] PI fetch failed', piRes.status, await piRes.text());
    return json({ error: 'Could not reach the payment gateway.' }, 502);
  }
  const pi = await piRes.json();
  const received = Number(pi.amount_received ?? 0);
  if (received <= 0) return json({ error: 'That payment was never captured.' }, 409);
  const alreadyRefunded = Number(pi.latest_charge?.amount_refunded ?? 0);
  const remaining = Math.max(0, received - alreadyRefunded);
  if (remaining <= 0) return json({ error: 'This payment is already fully refunded.' }, 409);

  const refundNow = Math.min(input.amount_cents, remaining);

  // --- Issue the refund ------------------------------------------------------
  // Idempotency-Key is keyed on the booking + amount so a double-clicked button
  // or a retried server action reuses the same refund instead of issuing two.
  const refRes = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `movvy_refund_${booking.id}_${alreadyRefunded}_${refundNow}`,
    },
    body: new URLSearchParams({
      payment_intent: piId,
      amount: String(refundNow),
      'metadata[booking_id]': booking.id,
      'metadata[short_code]': (booking as any).short_code ?? '',
      'metadata[reason]': input.reason ?? '',
    }).toString(),
  });
  if (!refRes.ok) {
    const detail = await refRes.text();
    console.error('[admin-refund-booking] refund failed', refRes.status, detail);
    return json({ error: 'The payment gateway refused the refund.' }, 502);
  }
  const refund = await refRes.json();

  // No local write here on purpose. The signature-verified `charge.refunded`
  // webhook sets payment_status and payments.refunded_cents — writing them here
  // too would race it and give two answers for the same question.
  return json({
    ok: true,
    refunded_cents: refundNow,
    refundable_remaining_cents: remaining - refundNow,
    refund_id: refund.id ?? null,
  });
});
