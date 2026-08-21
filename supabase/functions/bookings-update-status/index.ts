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
  // Crews forget to press buttons. If it's 4:30 and they actually left the
  // pickup at 4:15, they can say so instead of the bill absorbing 15 minutes
  // in whichever direction. See the validation block below — a backdated stamp
  // is bounded, monotonic, and never in the future, because "let the crew pick
  // the time" is otherwise a licence to write their own invoice.
  occurred_at: z.string().datetime().optional(),
});

// How far back a correction may reach. A crew fixing a missed tap is minutes
// or an hour out; twelve hours is longer than any single Movvy move, so this
// bounds the damage of a fat finger or a malicious entry without getting in a
// real crew's way.
const MAX_BACKDATE_HOURS = 12;
// Tolerate a little clock skew on the device so a phone running 30s fast
// doesn't get its honest "now" rejected as the future.
const FUTURE_SKEW_MS = 2 * 60 * 1000;

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
    const { booking_id, new_status, reason, occurred_at } = parsed.data;

    const supabase = userClient(req.headers.get('Authorization'));

    // Stamp the right lifecycle timestamp alongside the status change.
    // Billing window is now "We've left HQ" (on_the_way) → "Finish Move"
    // (completed). The driver's HQ commute is part of what the customer
    // pays for — actual time captured continuously through the whole
    // job. 'arrived' / 'loading' / 'in_transit' / 'unloading' are kept
    // as informational status updates that drive customer notifications
    // but do not affect when the meter starts / stops.
    // ── When did this actually happen? ──────────────────────────────────────
    // Default is now. A crew may supply occurred_at to correct a tap they
    // forgot — "it's 4:30, we left the pickup at 4:15". Every downstream
    // calculation then uses the corrected instant automatically: the billed
    // hours come from started_at → completed_at, and measured_transit_km sums
    // GPS pings BETWEEN in_transit_at and unloading_at, so fixing the timestamp
    // also fixes which part of the location trace is treated as the highway
    // drive. That's the whole point — the phone already recorded where it was
    // at 4:15; the only thing missing was the crew saying so.
    //
    // Bounded three ways, because otherwise this is a text box that writes the
    // invoice:
    //   • never in the future (beyond a little device clock skew)
    //   • never further back than MAX_BACKDATE_HOURS
    //   • never before the previous milestone, so the timeline can't invert
    const nowMs = Date.now();
    let effectiveMs = nowMs;
    if (occurred_at) {
      const t = new Date(occurred_at).getTime();
      if (!Number.isFinite(t)) throw httpError(400, 'That time could not be read.');
      if (t > nowMs + FUTURE_SKEW_MS) {
        throw httpError(400, "That time is in the future — pick when it actually happened.");
      }
      if (t < nowMs - MAX_BACKDATE_HOURS * 3600_000) {
        throw httpError(
          400,
          `That time is more than ${MAX_BACKDATE_HOURS} hours ago. Contact Movvy support to correct it.`,
        );
      }
      effectiveMs = t;
    }

    // Monotonic check against the timestamps already on the booking. A crew
    // can't say they left the drop-off before they arrived at the pickup —
    // computeActualBill subtracts one from the other, so an inverted pair
    // produces negative hours and a nonsense bill.
    if (occurred_at) {
      const { data: prior } = await supabase
        .from('bookings')
        .select('started_at, in_transit_at, unloading_at')
        .eq('id', booking_id)
        .maybeSingle();
      const earlier = [
        new_status !== 'on_the_way' ? prior?.started_at : null,
        new_status === 'unloading' || new_status === 'completed' ? prior?.in_transit_at : null,
        new_status === 'completed' ? prior?.unloading_at : null,
      ]
        .filter(Boolean)
        .map((s) => new Date(s as string).getTime())
        .filter((n) => Number.isFinite(n));
      const floor = earlier.length ? Math.max(...earlier) : null;
      if (floor != null && effectiveMs < floor) {
        throw httpError(
          400,
          `That time is before an earlier step on this move (${new Date(floor).toISOString()}). Pick a later time.`,
        );
      }
    }

    const effectiveAt = new Date(effectiveMs).toISOString();

    const stamp: Record<string, string> = { status: new_status };
    if (new_status === 'on_the_way') stamp.started_at = effectiveAt;
    // The transit window — the customer's live meter pauses between these two
    // on a long haul, since that stretch is billed by the kilometre.
    if (new_status === 'in_transit') stamp.in_transit_at = effectiveAt;
    if (new_status === 'unloading') stamp.unloading_at = effectiveAt;
    if (new_status === 'completed') stamp.completed_at = effectiveAt;
    if (new_status === 'cancelled') {
      stamp.cancelled_at = effectiveAt;
      stamp.cancellation_reason = reason ?? 'Cancelled by crew';
    }

    // ── Authorization, then the write ───────────────────────────────────────
    // This used to run the UPDATE through the caller's own client and lean on
    // the `bookings_partner_update` RLS policy as the gate. Migration 0101 then
    // narrowed non-admin writes on bookings to `status` + `updated_at` only —
    // and every stamp above except 'arrived'/'loading' touches a second column.
    // The result: "We've left HQ", "Finish Move" and crew-side cancel all
    // failed with "Bookings are server-owned", so a crew could not start, end,
    // or cancel a single move. Nothing downstream ran either — no billing
    // window, no live meter, no payout, no receipt.
    //
    // So: check the SAME predicate the RLS policy used — is_assigned_to_booking
    // is a security-definer function evaluated against the caller's auth.uid()
    // — and then write with the service role, which 0101 exempts. The gate is
    // unchanged; only the client doing the write is. The status-transition
    // trigger still fires for the service role (it is not role-aware), so the
    // state machine remains the second gate.
    const { data: mayUpdate, error: gateErr } = await supabase
      .rpc('is_assigned_to_booking', { p_booking_id: booking_id });
    if (gateErr || mayUpdate !== true) {
      throw httpError(403, 'Not authorized to update this booking');
    }

    const { data, error } = await adminClient()
      .from('bookings')
      .update(stamp)
      .eq('id', booking_id)
      .select('id, short_code, status, customer_id, started_at, completed_at, hourly_rate_customer_cents, materials_cents, fuel_cents, is_long_haul, transit_cents, transit_km, deposit_cents, deposit_status, deposit_refunded_cents, credit_applied_cents, stripe_deposit_payment_intent_id')
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
          // A trace that reaches here has already passed the coverage test in
          // measured_transit_km (0105) — it spans the transit window with no
          // long gaps. A partial trace returns NULL instead and leaves the
          // quote standing, which is why the floor can now be tight.
          //
          // Floor raised from 0.8 to 0.95: at 0.8 a Calgary → Fort McMurray
          // measurement that came in low could cut $584 off a $2,920 transit
          // charge, roughly $490 of it out of the crew's pocket. A chord sum
          // over a well-covered trace tracks road distance within about 1%, so
          // 5% is generous slack for genuine measurement error while capping
          // what a bad reading can move. The 1.1 ceiling stays — a detour, or a
          // phone that woke mid-route and drew a straight line, must not be
          // able to inflate someone's bill.
          const floor = billedTransitKm * 0.95;
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

      // ─── Give back an over-collected deposit ──────────────────────────
      // The deposit is 20% of the ESTIMATE; the bill is the ACTUAL time. Beat
      // the estimate by enough and the deposit covers the entire move with
      // money left over. That surplus is the customer's, and nothing used to
      // return it: the receipt clamped the deposit line down so the arithmetic
      // still looked right, the final-charge path saw a zero balance and marked
      // the move captured, and the difference simply stayed with Movvy.
      //
      // Refunded here rather than at final-payment time because a fully covered
      // move never reaches the payment sheet — that is exactly the case where
      // the customer is owed money, so it cannot be the one path that skips it.
      if (!billErr) {
        await refundDepositOverpayment(booking_id, data, actualBill.actualTotalCents);
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
      payload: {
        new_status,
        reason,
        actual_bill: actualBill,
        // A corrected time changes the bill, so leave a trail: what they said
        // happened, when they said it, and how far back the correction reached.
        ...(occurred_at
          ? {
              backdated: true,
              occurred_at: effectiveAt,
              recorded_at: new Date(nowMs).toISOString(),
              backdated_by_minutes: Math.round((nowMs - effectiveMs) / 60000),
            }
          : {}),
      },
    });

    // ─── Customer milestone notification ────────────────────────────────────
    // Each move stage the crew flips → a push + in-app notification to the
    // customer so they get real-time "your crew arrived / is loading / …"
    // updates. The notifications_push_fanout trigger delivers it to their
    // device. Fire-and-forget; a notification failure must never fail the
    // status transition itself.
    // NOTHING TO DO HERE — and that is deliberate.
    //
    // This function used to insert its own customer milestone notification for
    // on_the_way / arrived / loading / in_transit / unloading / completed. But
    // the `bookings_notify_status` trigger on bookings (defined in 0009,
    // body last replaced by 0037's notify_customer_on_status_change) already
    // writes exactly one in_app row for EVERY status change, and 0063's
    // notifications_push_fanout then pushes any in_app or push row to the
    // customer's devices.
    //
    // So the insert here was a second, differently-worded row for the same
    // event: two inbox entries, two banners, and — once the paid Apple account
    // exists — two pushes, for all six of those transitions. It never showed up
    // in production only because the completed test bookings were transitioned
    // by direct database writes rather than through this endpoint; the first
    // real crew driving a move through the app would have doubled every
    // milestone.
    //
    // The trigger is the right single source: it fires however the status
    // changes, including admin tools and direct SQL, which this function cannot.
    // If the customer-facing copy needs to change, change it in a migration to
    // notify_customer_on_status_change — not by adding a second writer here.

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

/**
 * Return the part of the deposit that exceeded the final bill.
 *
 * Deliberately non-fatal in every failure branch: the move is finished and the
 * crew is waiting on this response. A refund that doesn't go through leaves
 * money owed, which is recoverable by hand from the console; a 500 here leaves
 * a completed move stuck in `unloading`, which is not.
 *
 * Idempotent through Stripe's Idempotency-Key, keyed on the booking and the
 * exact amount, so a retried completion cannot refund twice.
 */
async function refundDepositOverpayment(
  bookingId: string,
  booking: any,
  actualTotalCents: number,
): Promise<void> {
  try {
    if (booking.deposit_status !== 'paid') return;
    const piId = booking.stripe_deposit_payment_intent_id;
    if (!piId) return;

    const depositPaid = Number(booking.deposit_cents ?? 0);
    const alreadyBack = Number(booking.deposit_refunded_cents ?? 0);
    const credit = Number(booking.credit_applied_cents ?? 0);
    // Credit counts toward covering the bill, so it makes the cash surplus
    // bigger, not smaller.
    const surplus = depositPaid + credit - actualTotalCents - alreadyBack;
    // Stripe's floor is $0.50; below that a refund costs more than it returns.
    if (surplus < 50) return;
    // Never hand back more cash than was taken as cash.
    const refundCents = Math.min(surplus, depositPaid - alreadyBack);
    if (refundCents < 50) return;

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) {
      console.error('[bookings-update-status] overpayment owed but Stripe unset', {
        bookingId, refundCents,
      });
      return;
    }

    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `movvy_overpay_${bookingId}_${refundCents}`,
      },
      body: new URLSearchParams({
        payment_intent: piId,
        amount: String(refundCents),
        reason: 'requested_by_customer',
        'metadata[booking_id]': bookingId,
        'metadata[kind]': 'deposit_overpayment',
      }).toString(),
    });

    if (!res.ok) {
      console.error('[bookings-update-status] overpayment refund refused',
        res.status, await res.text());
      return;
    }

    // Record it so the final-charge path stops crediting a deposit that is no
    // longer held, and the receipt can show the customer where it went. The
    // charge.refunded webhook confirms this independently.
    await adminClient()
      .from('bookings')
      .update({ deposit_refunded_cents: alreadyBack + refundCents })
      .eq('id', bookingId);

    await adminClient().from('notifications').insert({
      profile_id: booking.customer_id,
      channel: 'in_app',
      category: 'booking.refund',
      title: 'Money back on your move',
      body: `Your crew finished under the estimate, so $${(refundCents / 100).toFixed(2)} of your deposit is on its way back to your card.`,
      data: { booking_id: bookingId, refund_cents: refundCents },
    });
  } catch (e) {
    console.error('[bookings-update-status] overpayment refund threw', e);
  }
}
