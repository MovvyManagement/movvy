// =============================================================================
// admin-refund-booking
// -----------------------------------------------------------------------------
// Management-only STANDALONE refund for a booking (does NOT cancel the move).
//
// Contract:
//   POST { booking_id: string (uuid), amount_cents: int > 0, reason?: string }
//   -> 200 { ok: true, refunded_cents, refund_cents_total }
//   -> 4xx { error: string }
//
// Access: management only. We resolve the caller's tier via the same RPC the
// web app uses (movvy_admin_access -> 'management' | 'staff' | null), running
// as the caller so RLS + policy stay in effect.
//
// TODAY (pre-Stripe): a refund is bookkeeping only. We add amount_cents to the
// booking's refund_cents column (capped at the booking total). No money moves.
//
// WHEN STRIPE IS CONNECTED: perform the real refund inside the clearly-marked
// STRIPE REFUND block below (refund the stored payment_intent / charge for
// amount_cents) BEFORE writing refund_cents, and abort on gateway failure.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

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

  // --- Load booking ----------------------------------------------------------
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, price_total_cents, refund_cents, status')
    .eq('id', input.booking_id)
    .single();
  if (bErr || !booking) return json({ error: 'Booking not found.' }, 404);

  const total = Number(booking.price_total_cents ?? 0);
  const already = Number(booking.refund_cents ?? 0);
  const remaining = Math.max(0, total - already);
  if (remaining <= 0) return json({ error: 'This booking is already fully refunded.' }, 409);

  const refundNow = Math.min(input.amount_cents, remaining);

  // ===========================================================================
  // STRIPE REFUND (TODO — wire when Stripe is connected)
  // ---------------------------------------------------------------------------
  // Stripe is not integrated yet, so this is bookkeeping only for now. Once the
  // payment_intent / charge id is stored on the booking, do the real refund
  // here and bail out on failure BEFORE writing refund_cents below:
  //
  //   const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  //   const pi = booking.stripe_payment_intent_id;
  //   if (!pi) return json({ error: 'No payment on file to refund.' }, 409);
  //   try {
  //     await stripe.refunds.create({ payment_intent: pi, amount: refundNow });
  //   } catch (e) {
  //     return json({ error: 'Payment gateway refused the refund.' }, 502);
  //   }
  // ===========================================================================

  const newRefundTotal = already + refundNow;
  const { error: uErr } = await supabase
    .from('bookings')
    .update({ refund_cents: newRefundTotal })
    .eq('id', input.booking_id);
  if (uErr) return json({ error: 'Failed to record refund.' }, 500);

  return json({ ok: true, refunded_cents: refundNow, refund_cents_total: newRefundTotal });
});
