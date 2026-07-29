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
      .select('id, status, assigned_company_id, assigned_driver_profile_id, dispatch_accepted_at')
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

    if (
      booking.status === 'assigned'
      && booking.assigned_company_id === company_id
      && booking.assigned_driver_profile_id === null
    ) {
      // (b) A company that accepted a job but can't staff it releases it back to
      // the open pool. We used to cap this at 5 minutes after accepting, but that
      // stranded jobs an operator genuinely couldn't cover — a no-show is far
      // worse than a re-listing. Release is still only reachable while NO driver
      // is assigned (checked above), so it can't yank a job out from under a
      // crew that's already rolling.

      // Push it back to searching
      const { data, error: uErr } = await admin
        .from('bookings')
        .update({
          status: 'searching',
          assigned_company_id: null,
          assigned_team_id: null,
          assigned_driver_profile_id: null,
          dispatch_accepted_at: null,
        })
        .eq('id', booking_id)
        .eq('status', 'assigned')
        .eq('assigned_company_id', company_id)
        .is('assigned_driver_profile_id', null)
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

      return jsonResponse({ ok: true, action: 'released', booking: data }, { status: 200 }, cors);
    }

    throw httpError(409, 'Booking is not in a state your company can decline.');
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-dispatch-decline] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
