// POST /bookings-update-status
// Driver (assigned) progresses a booking through the status state machine.
// The DB trigger `enforce_booking_status_transition` is the final gate;
// this edge function adds rate limiting + audit log + status timestamps.
//
// Billing timer:
//   • When status → 'arrived' we stamp started_at = now() — this is the
//     "Begin Move" press at the pickup. The customer is billed for real
//     time from this moment forward.
//   • When status → 'completed' we stamp completed_at = now() AND run
//     computeActualBill() to fill in the actual_* invoice columns
//     (actual_total_cents, actual_driver_payout_cents, etc.). The original
//     price_total_cents stays as the booking-time ESTIMATE so customer +
//     admin can compare what was quoted vs what was billed.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient,
  audit,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
  requireAuth,
  userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { computeActualBill } from '../_shared/pricing.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  new_status: z.enum([
    'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading', 'completed', 'cancelled',
  ]),
  reason: z.string().max(200).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // Drivers + admins only
    if (!['driver', 'mover', 'company_owner', 'company_dispatcher', 'movvy_admin'].includes(user.role)) {
      throw httpError(403, 'Only the assigned crew can update status');
    }

    // 60 status updates per hour per driver — generous; typical move is ~6 transitions
    await checkRateLimit({
      bucketKey: `user:${user.id}:bookings_update_status`,
      endpoint: 'bookings-update-status',
      limit: 60,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, new_status, reason } = parsed.data;

    const supabase = userClient(req.headers.get('Authorization'));

    // Stamp the right lifecycle timestamp alongside the status change.
    // Billing window is now "We've left HQ" (on_the_way) → "Finish Move"
    // (completed). The driver's HQ commute is part of what the customer
    // pays for — actual time captured continuously through the whole
    // job. 'arrived' / 'loading' / 'in_transit' / 'unloading' are kept
    // as informational status updates that drive customer notifications
    // but do not affect when the meter starts / stops.
    const stamp: Record<string, string> = { status: new_status };
    if (new_status === 'on_the_way') stamp.started_at = new Date().toISOString();
    if (new_status === 'completed') stamp.completed_at = new Date().toISOString();
    if (new_status === 'cancelled') {
      stamp.cancelled_at = new Date().toISOString();
      stamp.cancellation_reason = reason ?? 'Cancelled by crew';
    }

    // RLS + the status-transition trigger are the security gates here.
    // If the user isn't assigned or the transition is invalid, this returns an error.
    const { data, error } = await supabase
      .from('bookings')
      .update(stamp)
      .eq('id', booking_id)
      .select('id, short_code, status, started_at, completed_at, hourly_rate_customer_cents, materials_cents, fuel_cents')
      .single();

    if (error) {
      // 22023 = invalid_parameter_value — used by our state-machine trigger
      if (error.code === '22023') throw httpError(400, error.message);
      throw httpError(403, 'Not authorized to update this booking');
    }

    // ─── Actual-bill computation on completion ──────────────────────────
    // We use the SERVICE role for this update (via adminClient) because the
    // driver's RLS only allows them to write status fields, not money.
    // The math is server-side — no client can mess with the numbers.
    let actualBill: ReturnType<typeof computeActualBill> | null = null;
    if (new_status === 'completed' && data.started_at && data.completed_at) {
      actualBill = computeActualBill({
        startedAt: data.started_at,
        completedAt: data.completed_at,
        hourlyRateCustomerCents: data.hourly_rate_customer_cents ?? 17500,
        materialsCents: data.materials_cents ?? 5000,
        fuelCents: data.fuel_cents ?? 0,
      });

      const admin = adminClient();
      const { error: billErr } = await admin
        .from('bookings')
        .update({
          actual_hours: actualBill.actualHours,
          actual_subtotal_cents: actualBill.actualSubtotalCents,
          actual_gst_cents: actualBill.actualGstCents,
          actual_total_cents: actualBill.actualTotalCents,
          actual_commission_cents: actualBill.actualCommissionCents,
          actual_driver_payout_cents: actualBill.actualDriverPayoutCents,
        })
        .eq('id', booking_id);

      if (billErr) {
        console.error('[bookings-update-status] actual-bill write failed', billErr);
        // Non-fatal — the status transitioned, the customer + admin still
        // see the booking as completed. The actual_* columns can be
        // backfilled via a recompute endpoint if needed.
      }
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.status_updated',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { new_status, reason, actual_bill: actualBill },
    });

    return jsonResponse(
      { ok: true, booking: data, actual_bill: actualBill },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-update-status] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
