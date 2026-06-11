// POST /tips-submit
// Customer adds a tip to a completed booking. Movvy keeps 10%, driver gets 90%.
// Idempotent-ish: re-submitting the same amount is a no-op; a higher amount replaces.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { splitTip } from '../_shared/pricing.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  amount_cents: z.number().int().min(0).max(50_000),  // hard ceiling $500 to avoid fat-finger
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:tips_submit`,
      endpoint: 'tips-submit',
      limit: 30, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, amount_cents } = parsed.data;

    const admin = adminClient();

    // Load booking — verify customer + completed
    const { data: booking, error: loadErr } = await admin
      .from('bookings')
      .select('id, customer_id, status, tip_cents, completed_at')
      .eq('id', booking_id)
      .single();
    if (loadErr || !booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, 'Only the customer can tip');
    if (booking.status !== 'completed') throw httpError(400, 'Can only tip a completed move');

    // 24-hour tipping window — after that, drivers have already received
    // their payout batch so adjusting the split gets messy. Customers can
    // contact support if they really need to tip later.
    if (booking.completed_at) {
      const completedMs = new Date(booking.completed_at).getTime();
      const elapsedHours = (Date.now() - completedMs) / (1000 * 60 * 60);
      if (elapsedHours > 24) {
        throw httpError(
          403,
          "Tipping window closed. You can add or change your tip within 24h of move completion — contact support for late tips.",
        );
      }
    }

    const split = splitTip(amount_cents);

    // Update bookings — trigger `bookings_bump_payout_on_tip` updates driver_payouts atomically
    const { error: upErr } = await admin
      .from('bookings')
      .update({
        tip_cents: split.tipCents,
        tip_movvy_cut_cents: split.movvyCutCents,
        tip_driver_cents: split.driverCents,
        tipped_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (upErr) throw httpError(500, 'Could not save tip');

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'tip.submitted',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { tip_cents: split.tipCents, driver_cents: split.driverCents, movvy_cut_cents: split.movvyCutCents },
    });

    return jsonResponse({ ok: true, ...split }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[tips-submit] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
