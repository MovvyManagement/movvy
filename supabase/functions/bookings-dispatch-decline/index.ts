// =============================================================================
// POST /bookings-dispatch-decline
//
// Company owner / dispatcher releases a booking back to the open queue.
//
// Two valid cases:
//   (a) Booking is `searching` — we just record the decline as a soft
//       signal so the matching engine knows to skip this company next time.
//       (For now the table for that signal is TODO; we audit-log only.)
//   (b) Booking is `assigned` to my company with no driver — we push it
//       back to `searching` so other partners can pick it up. Only allowed
//       within 5 minutes of dispatch_accepted_at to avoid bait-and-release.
// =============================================================================

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
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  company_id: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

// Releasing is free while there's still time to re-staff the move. Inside this
// window the customer's move day is already locked in, so it costs the org a
// flat fee — the release still goes through (a no-show hurts the customer far
// more than a re-listing), it just isn't free.
// Releasing is free while there's still time to re-staff the move. Inside this
// window it strands a customer who has already planned their day.
const FREE_RELEASE_DAYS = 2;
// Flat $100, regardless of the job's value. The percentage version is gone: the
// charge exists to discourage dropping a customer at short notice, and a fee
// that scales with revenue punishes the same behaviour unevenly while being
// impossible for a crew to predict before they press the button.
const LATE_RELEASE_PENALTY_CENTS = 10_000; // $100

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:dispatch_decline`,
      endpoint: 'bookings-dispatch-decline',
      limit: 30,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, company_id, reason } = parsed.data;

    const admin = adminClient();

    // Caller must be an ACTIVE owner or dispatcher (excludes pending/rejected)
    const { data: dispatcher } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', company_id)
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .is('removed_at', null)
      .maybeSingle();
    if (!dispatcher || !['owner', 'dispatcher'].includes(dispatcher.role)) {
      throw httpError(403, 'Only owners and dispatchers can decline bookings');
    }

    // Read the current state
    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select('id, short_code, status, assigned_company_id, assigned_driver_profile_id, dispatch_accepted_at, scheduled_for_date, scheduled_for_window_starts_at')
      .eq('id', booking_id)
      .maybeSingle();
    if (bErr || !booking) throw httpError(404, 'Booking not found');

    if (booking.status === 'searching') {
      // (a) Just log the decline so the matcher can use it as a signal.
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: 'booking.dispatch_decline_searching',
        entityType: 'booking',
        entityId: booking_id,
        ip: clientIp(req),
        ua: req.headers.get('user-agent') ?? undefined,
        payload: { company_id, reason },
      });
      return jsonResponse({ ok: true, action: 'noted' }, { status: 200 }, cors);
    }

    if (booking.status === 'assigned' && booking.assigned_company_id === company_id) {
      // (b) An org gives an accepted move back to the open pool.
      //
      // This used to require assigned_driver_profile_id IS NULL, so once an
      // admin had staffed the move (including self-assigning) Release ALWAYS
      // failed with a 409 — exactly the case where you most want it, because
      // the person you put on it can't make it any more. Releasing clears the
      // performer along with the org, and status='assigned' still means the
      // move hasn't started, so nothing is yanked out from under a rolling
      // crew (in-flight moves are past 'assigned' and fall through to the 409
      // below).
      const { data, error: uErr } = await admin
        .from('bookings')
        .update({
          status: 'searching',
          assigned_company_id: null,
          assigned_team_id: null,
          assigned_driver_profile_id: null,
          tracking_profile_id: null,
          dispatch_accepted_at: null,
        })
        .eq('id', booking_id)
        .eq('status', 'assigned')
        .eq('assigned_company_id', company_id)
        .select('id, short_code, status')
        .single();
      if (uErr || !data) throw httpError(409, 'Booking state changed — refresh and try again');

      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: 'booking.dispatch_release',
        entityType: 'booking',
        entityId: booking_id,
        ip: clientIp(req),
        ua: req.headers.get('user-agent') ?? undefined,
        payload: { company_id, reason },
      });

      // ─── Late-release penalty ───────────────────────────────────────────
      // Measured from the move's window start (falling back to 08:00 on the
      // scheduled date, same as the cancel policy).
      const scheduled = (booking as any).scheduled_for_window_starts_at
        ? new Date((booking as any).scheduled_for_window_starts_at)
        : (booking as any).scheduled_for_date
        ? new Date(`${(booking as any).scheduled_for_date}T08:00:00Z`)
        : null;
      const hoursBefore = scheduled
        ? (scheduled.getTime() - Date.now()) / 3_600_000
        : null;
      let penaltyCents = 0;
      if (hoursBefore != null && hoursBefore < FREE_RELEASE_DAYS * 24) {
        // Flat $100, whatever the job is worth. Founder's call: a percentage
        // made the fee unpredictable — the same mistake cost $100 on a small
        // move and $800 on a long haul — and the point of the charge is to
        // discourage dropping a customer two days out, not to scale with
        // revenue. One number a crew can remember is also one they can't
        // argue about.
        penaltyCents = LATE_RELEASE_PENALTY_CENTS;

        // Fire-and-forget: a ledger hiccup must never block the release itself,
        // otherwise the crew is stuck holding a move they can't do.
        try {
          await admin.from('release_penalties').insert({
            booking_id,
            company_id,
            profile_id: user.id,
            amount_cents: penaltyCents,
            reason:
              reason ??
              `Released within ${FREE_RELEASE_DAYS} days of the move — ` +
              `$${LATE_RELEASE_PENALTY_CENTS / 100} flat fee`,
            hours_before_move: Math.round((hoursBefore ?? 0) * 100) / 100,
          });
        } catch (penErr) {
          console.error('[bookings-dispatch-decline] penalty write failed', penErr);
        }
      }

      return jsonResponse(
        { ok: true, action: 'released', booking: data, penalty_cents: penaltyCents },
        { status: 200 },
        cors,
      );
    }

    throw httpError(409, 'Booking is not in a state your company can decline.');
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-dispatch-decline] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
