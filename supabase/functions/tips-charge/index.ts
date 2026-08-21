// =============================================================================
// POST /tips-charge   { booking_id: uuid, amount_cents: int }
// -----------------------------------------------------------------------------
// Actually COLLECTS a post-move tip, then records it.
//
// WHY THIS EXISTS
// ---------------
// The Move-complete screen offered 15/18/20/25% tip chips and sent them to
// tips-submit — which, by design, only ever RECORDS a tip Stripe has already
// captured. It refuses anything else, and correctly so: the
// bookings_bump_payout_on_tip trigger adds the tip to driver_payouts, so
// recording an uncollected tip means Movvy owes a crew money it never took.
//
// The result was a tip button that could not succeed. Every tap came back
// "Edge Function returned a non-2xx status code" — either the $500 ceiling
// (20% of a $2,586 move is $517) or, past that, the collection check.
//
// So this endpoint charges first and records second. Two paths:
//
//   1. OFF-SESSION. The customer's card was saved at checkout
//      (setup_future_usage=off_session), so the tip is charged with one tap and
//      no sheet. This is the normal path for anything booked after that shipped.
//
//   2. ON-SESSION FALLBACK. No saved card, or the bank demands authentication
//      (3-D Secure). We return the PaymentIntent's client_secret and the app
//      presents the Payment Sheet. Older bookings always land here, and so does
//      any card whose issuer wants a challenge.
//
// The tip is only written to the booking once Stripe reports the money taken.
// A failed or abandoned charge leaves tip_cents untouched, so a crew is never
// credited a tip that no one paid.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError,
  jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  // Ceiling is a share of the bill rather than a flat dollar figure. The old
  // flat $500 cap silently rejected the screen's own 20% chip on any move over
  // ~$2,500, which is an ordinary three-bedroom.
  amount_cents: z.number().int().min(0).max(200_000),
});

/** Tips are 100% the crew's — Movvy takes nothing. Mirrors splitTip in 0058. */
function splitTip(tipCents: number) {
  return { tipCents, movvyCutCents: 0, driverCents: tipCents };
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    await checkRateLimit({
      bucketKey: `user:${user.id}:tips_charge`,
      endpoint: 'tips-charge',
      limit: 12, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, amount_cents } = parsed.data;

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) throw httpError(503, 'Payments are not configured yet.');

    const admin = adminClient();
    const { data: booking, error: loadErr } = await admin
      .from('bookings')
      .select('id, short_code, customer_id, status, completed_at, tip_cents, actual_total_cents, price_total_cents')
      .eq('id', booking_id)
      .maybeSingle();

    if (loadErr) {
      console.error('[tips-charge] booking load failed', loadErr);
      throw httpError(500, 'Could not read that move.');
    }
    if (!booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, 'Only the customer can tip');
    if (booking.status !== 'completed') throw httpError(400, 'You can tip once the move is finished.');

    // 24-hour window, same as tips-submit: after that the crew's payout batch
    // has been calculated and moving the number gets messy.
    if (booking.completed_at) {
      const hours = (Date.now() - new Date(booking.completed_at).getTime()) / 3_600_000;
      if (hours > 24) {
        throw httpError(403, 'The tipping window closed 24 hours after your move. Message support if you still want to tip.');
      }
    }

    const alreadyTipped = Number(booking.tip_cents ?? 0);
    if (amount_cents <= alreadyTipped) {
      // Nothing new to collect. Lowering a tip is not supported here — the
      // money is already with the crew — so say so rather than pretending.
      throw httpError(
        409,
        alreadyTipped > 0
          ? `You've already tipped $${(alreadyTipped / 100).toFixed(2)} on this move.`
          : 'Pick a tip amount first.',
      );
    }
    const chargeCents = amount_cents - alreadyTipped;
    if (chargeCents < 50) throw httpError(400, 'The smallest tip we can charge is $0.50.');

    // Sanity ceiling tied to the actual bill, so a mis-tap can't send a
    // four-figure tip on a small move. 100% of the bill is generous headroom.
    const bill = Number(booking.actual_total_cents ?? booking.price_total_cents ?? 0);
    if (bill > 0 && amount_cents > bill) {
      throw httpError(400, `That's more than the move itself ($${(bill / 100).toFixed(2)}). Pick a smaller tip.`);
    }

    // ── Who are we charging? ────────────────────────────────────────────────
    const { data: prof } = await admin
      .from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
    const customerId = (prof as any)?.stripe_customer_id ?? null;

    // The card saved at checkout, if there is one. Newest first: if someone
    // paid with a different card recently, that is the one they expect.
    let paymentMethodId: string | null = null;
    if (customerId) {
      const pmRes = await fetch(
        `https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      );
      if (pmRes.ok) paymentMethodId = (await pmRes.json())?.data?.[0]?.id ?? null;
      else console.warn('[tips-charge] payment method lookup failed', await pmRes.text());
    }

    // ── Create the charge ───────────────────────────────────────────────────
    const params: Record<string, string> = {
      amount: String(chargeCents),
      currency: 'cad',
      description: `Movvy tip — move #${booking.short_code ?? ''}`,
      'metadata[booking_id]': booking.id,
      'metadata[kind]': 'tip',
      'metadata[tip_cents]': String(chargeCents),
    };
    if (customerId) params.customer = customerId;

    if (paymentMethodId) {
      // One tap, no sheet — the card is on file and the customer agreed at
      // checkout that it could be used for this move.
      params.payment_method = paymentMethodId;
      params.confirm = 'true';
      params.off_session = 'true';
    } else {
      params['automatic_payment_methods[enabled]'] = 'true';
      params.setup_future_usage = 'off_session';
    }

    const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Keyed on the amount so changing your mind creates a new intent but a
        // double-tap does not create a second charge.
        'Idempotency-Key': `movvy_tip_${booking.id}_${amount_cents}`,
      },
      body: form(params),
    });

    const pi = await piRes.json();

    if (!piRes.ok) {
      // A card that needs 3-D Secure comes back as an error with the intent
      // attached. That is not a failure — it's a request for the customer to
      // approve, so hand the app what it needs to present the sheet.
      const intent = pi?.error?.payment_intent;
      if (intent?.client_secret) {
        return jsonResponse({
          needs_action: true,
          client_secret: intent.client_secret,
          amount_cents: chargeCents,
        }, { status: 200 }, cors);
      }
      console.error('[tips-charge] PI create failed', piRes.status, JSON.stringify(pi?.error ?? pi));
      throw httpError(502, pi?.error?.message ?? 'Your bank declined the tip. Try another card.');
    }

    if (pi.status !== 'succeeded') {
      // Needs the sheet: either no saved card, or the issuer wants a challenge.
      return jsonResponse({
        needs_action: true,
        client_secret: pi.client_secret,
        amount_cents: chargeCents,
      }, { status: 200 }, cors);
    }

    // ── Money is in. Record it. ─────────────────────────────────────────────
    const split = splitTip(amount_cents);
    const { error: upErr } = await admin
      .from('bookings')
      .update({
        tip_cents: split.tipCents,
        tip_movvy_cut_cents: split.movvyCutCents,
        tip_driver_cents: split.driverCents,
        tipped_at: new Date().toISOString(),
      })
      .eq('id', booking.id);

    if (upErr) {
      // The charge went through — never tell the customer it failed, or they
      // will tip again. Log loudly; the money is in Stripe either way.
      console.error('[tips-charge] CHARGED BUT NOT RECORDED', booking.id, chargeCents, upErr);
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'tip.charged',
      entityType: 'booking',
      entityId: booking.id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { amount_cents, charged_cents: chargeCents, payment_intent: pi.id },
    });

    return jsonResponse({
      ok: true,
      charged_cents: chargeCents,
      tip_cents: split.tipCents,
      payment_intent_id: pi.id,
    }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[tips-charge] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
