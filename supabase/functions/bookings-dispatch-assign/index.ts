// =============================================================================
// POST /bookings-dispatch-assign
//
// Company owner / dispatcher picks one of their drivers to run a booking
// that's already in their queue (status='assigned', assigned_company_id =
// my company, assigned_driver_profile_id IS NULL).
//
// Sets assigned_driver_profile_id + assigned_at; the driver gets a
// notification and the booking is now actionable by them in (mover)/active.
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
  driver_profile_id: z.string().uuid(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:dispatch_assign`,
      endpoint: 'bookings-dispatch-assign',
      limit: 120,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, company_id, driver_profile_id } = parsed.data;

    const admin = adminClient();

    // 1. Caller must be an ACTIVE owner / dispatcher of the company
    const { data: dispatcher } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', company_id)
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .is('removed_at', null)
      .maybeSingle();
    if (!dispatcher || !['owner', 'dispatcher'].includes(dispatcher.role)) {
      throw httpError(403, 'Only owners and dispatchers can assign drivers');
    }

    // 2. The target driver must be an ACTIVE driver in the same company.
    // status='active' is essential — a dispatcher must not be able to hand a
    // live customer move to someone who only self-joined and is still
    // pending_approval (or was rejected).
    const { data: driver } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', company_id)
      .eq('profile_id', driver_profile_id)
      .eq('status', 'active')
      .is('removed_at', null)
      .maybeSingle();
    if (!driver) throw httpError(400, 'Selected driver is not an active member of your company');
    if (driver.role !== 'driver') throw httpError(400, 'Selected member is not a driver');

    // 2b. The target driver must be fully verified — refuses assignment of
    // anyone whose ID / criminal check / employment contract is incomplete.
    const { data: canTakeJobs } = await admin.rpc('can_take_jobs', {
      p_profile_id: driver_profile_id,
    });
    if (canTakeJobs === false) {
      throw httpError(
        403,
        "This driver isn't fully verified yet — they need to finish uploading their documents first.",
      );
    }

    // 3. Atomic assign — booking must still be in the "needs driver" state.
    const { data, error } = await admin
      .from('bookings')
      .update({
        assigned_driver_profile_id: driver_profile_id,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', booking_id)
      .eq('assigned_company_id', company_id)
      .eq('status', 'assigned')
      .is('assigned_driver_profile_id', null)
      .select('id, short_code, status, assigned_driver_profile_id')
      .single();

    if (error || !data) {
      throw httpError(
        409,
        'Booking is no longer pending dispatch (may have been assigned already).',
      );
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.dispatch_assign',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { company_id, driver_profile_id },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-dispatch-assign] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
