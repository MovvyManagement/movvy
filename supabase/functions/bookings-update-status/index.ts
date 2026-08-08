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
import { computeActualBill, TRANSIT_CENTS_PER_KM } from '../_shared/pricing.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { moveComplete } from '../_shared/emails/index.ts';
import { fmtHours, fmtMoney } from '../_shared/format.ts';

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
    // The transit window — the customer's live meter pauses between these two
    // on a long haul, since that stretch is billed by the kilometre.
    if (new_status === 'in_transit') stamp.in_transit_at = new Date().toISOString();
    if (new_status === 'unloading') stamp.unloading_at = new Date().toISOString();
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
      .select('id, short_code, status, customer_id, started_at, completed_at, hourly_rate_customer_cents, materials_cents, fuel_cents, is_long_haul, transit_cents, transit_km')
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
      const admin = adminClient();

      // On a long haul the highway is paid for by the kilometre, so the drive
      // between the addresses has to come OFF the clock. booking_status_history
      // already timestamps every transition, so the span is derivable without
      // trusting anything the crew's device sends.
      let inTransitAt: string | null = null;
      let unloadingAt: string | null = null;
      if (data.is_long_haul) {
        const { data: hist } = await admin
          .from('booking_status_history')
          .select('new_status, created_at')
          .eq('booking_id', booking_id)
          .in('new_status', ['in_transit', 'unloading'])
          .order('created_at', { ascending: true });
        for (const row of hist ?? []) {
          if (row.new_status === 'in_transit' && !inTransitAt) inTransitAt = row.created_at;
          if (row.new_status === 'unloading' && !unloadingAt) unloadingAt = row.created_at;
        }
      }

      // ── Distance actually driven ──────────────────────────────────────
      // Sum the GPS trace across the transit window, then clamp it to a band
      // around the quote. Under-run passes through so a shorter route reaches
      // the customer as a smaller bill; over-run is capped, because a detour —
      // or a phone that woke up mid-route and drew a straight line — must not
      // be able to move someone's price. A sparse trace falls back to the quote.
      let billedTransitKm = Number(data.transit_km ?? 0);
      let billedTransitCents = data.transit_cents ?? 0;
      if (data.is_long_haul && inTransitAt && unloadingAt && billedTransitKm > 0) {
        const { data: measured } = await admin.rpc('measured_transit_km', {
          p_booking_id: booking_id,
          p_from: inTransitAt,
          p_to: unloadingAt,
        });
        const km = Number(measured);
        if (Number.isFinite(km) && km > 0) {
          const floor = billedTransitKm * 0.8;
          const ceiling = billedTransitKm * 1.1;
          billedTransitKm = Math.round(Math.min(Math.max(km, floor), ceiling) * 10) / 10;
          billedTransitCents = Math.round(billedTransitKm * TRANSIT_CENTS_PER_KM);
        }
      }

      actualBill = computeActualBill({
        startedAt: data.started_at,
        completedAt: data.completed_at,
        hourlyRateCustomerCents: data.hourly_rate_customer_cents ?? 17500,
        materialsCents: data.materials_cents ?? 5000,
        fuelCents: data.fuel_cents ?? 0,
        isLongHaul: !!data.is_long_haul,
        transitCents: billedTransitCents,
        inTransitAt,
        unloadingAt,
        // Fallback when the crew skipped a status: deduct the transit duration
        // we quoted rather than billing the drive at the hourly rate.
        quotedTransitMinutes: data.transit_km
          ? Math.round((Number(data.transit_km) / 90) * 60)
          : 0,
      });
      const { error: billErr } = await admin
        .from('bookings')
        .update({
          actual_hours: actualBill.actualHours,
          actual_subtotal_cents: actualBill.actualSubtotalCents,
          actual_gst_cents: actualBill.actualGstCents,
          actual_total_cents: actualBill.actualTotalCents,
          actual_commission_cents: actualBill.actualCommissionCents,
          actual_driver_payout_cents: actualBill.actualDriverPayoutCents,
          actual_transit_km: data.is_long_haul ? billedTransitKm : null,
          actual_transit_cents: data.is_long_haul ? billedTransitCents : null,
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

    // ─── Customer milestone notification ────────────────────────────────────
    // Each move stage the crew flips → a push + in-app notification to the
    // customer so they get real-time "your crew arrived / is loading / …"
    // updates. The notifications_push_fanout trigger delivers it to their
    // device. Fire-and-forget; a notification failure must never fail the
    // status transition itself.
    const CUSTOMER_MILESTONES: Record<string, { title: string; body: string }> = {
      on_the_way: { title: 'Your crew is on the way', body: 'Your movers have left and are heading to your pickup.' },
      arrived:    { title: 'Your crew has arrived', body: 'Your movers are at the pickup location.' },
      loading:    { title: 'Loading has started', body: 'Your crew has begun loading your belongings.' },
      in_transit: { title: 'On the way to your drop-off', body: 'Your belongings are on the way to the destination.' },
      unloading:  { title: 'Unloading has started', body: 'Your crew has arrived at the drop-off and is unloading.' },
      completed:  { title: 'Your move is complete 🎉', body: 'All done — thanks for moving with Movvy!' },
    };
    const milestone = CUSTOMER_MILESTONES[new_status];
    if (milestone && data.customer_id) {
      try {
        const admin = adminClient();
        // `channel` is NOT NULL with no default, and the fan-out trigger keys
        // off it — omit it and the row never lands, so neither the in-app
        // notification nor the push ever happens.
        const { error: notifWriteErr } = await admin.from('notifications').insert({
          profile_id: data.customer_id,
          channel: 'in_app',
          category: `booking.${new_status}`,
          title: milestone.title,
          body: milestone.body,
          data: { booking_id, short_code: data.short_code, new_status },
        });
        // supabase-js RETURNS errors rather than throwing, so the surrounding
        // try/catch never saw this. Log it explicitly.
        if (notifWriteErr) {
          console.error('[bookings-update-status] milestone notification insert failed', notifWriteErr);
        }
      } catch (notifErr) {
        console.warn('[bookings-update-status] milestone notification failed (non-fatal)', notifErr);
      }
    }

    // ─── Move-complete email ────────────────────────────────────────────────
    // Fires only on the completed transition + only if we computed an actual
    // bill (which requires both started_at + completed_at). Fire-and-forget.
    if (new_status === 'completed' && actualBill) {
      try {
        const admin = adminClient();
        const { data: bookingFull } = await admin
          .from('bookings')
          .select(
            'id, short_code, customer_id, assigned_driver_profile_id, customer:profiles!bookings_customer_id_fkey(email, full_name), crew_lead:profiles!bookings_assigned_driver_profile_id_fkey(full_name)',
          )
          .eq('id', booking_id)
          .maybeSingle();
        const customerEmail = (bookingFull as any)?.customer?.email;
        const customerName = (bookingFull as any)?.customer?.full_name;
        const crewLeadName = (bookingFull as any)?.crew_lead?.full_name ?? null;
        if (customerEmail) {
          sendBrandedEmail({
            to: customerEmail,
            template: moveComplete({
              fullName: customerName,
              shortCode: data.short_code,
              crewLeadName,
              actualHours: fmtHours(actualBill.actualHours),
              actualTotalDollars: fmtMoney(actualBill.actualTotalCents),
              receiptUrl: `https://movvy.ca/app/receipts/${booking_id}`,
              rateUrl: `https://movvy.ca/app/rate/${booking_id}`,
            }),
          }).catch((e) =>
            console.warn('[bookings-update-status] email send failed', e),
          );
        }
      } catch (emailErr) {
        console.warn('[bookings-update-status] email setup failed (non-fatal)', emailErr);
      }
    }

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
