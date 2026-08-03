// =============================================================================
// POST /bookings-dispatch-accept
//
// Company owner / dispatcher claims a `searching` booking for the company.
// The booking moves to status='assigned' with assigned_company_id set and
// assigned_driver_profile_id LEFT NULL — that's the signal to the rest of
// the system that this booking is awaiting driver assignment.
//
// A second call to bookings-dispatch-assign picks the actual driver.
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
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:dispatch_accept`,
      endpoint: 'bookings-dispatch-accept',
      limit: 60,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, company_id } = parsed.data;

    const admin = adminClient();

    // Verify the caller is an ACTIVE member of this org. Merged model: ANY
    // member — admin OR crew — can claim a job for the org (the job then
    // awaits a performer being assigned). status='active' excludes
    // pending_approval / rejected self-joins. Only ASSIGNING a performer
    // (bookings-dispatch-assign) stays admin-gated.
    const { data: membership } = await admin
      .from('company_members')
      .select('org_role')
      .eq('company_id', company_id)
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .is('removed_at', null)
      .maybeSingle();
    if (!membership) throw httpError(403, 'You are not a member of this org');

    // Capacity gate. Enforced HERE, not just in the UI — otherwise a crew with
    // a 16 ft van could still claim a 4-bedroom house through a stale screen or
    // a direct API call, and the customer finds out on move day. Checks, in
    // order: the org has a truck at all, its registration has been submitted,
    // and the biggest truck on file actually fits this move.
    const { data: verdict } = await admin.rpc('org_can_take_booking', {
      p_company_id: company_id,
      p_booking_id: booking_id,
    });
    if (verdict && (verdict as any).ok !== true) {
      throw httpError(400, (verdict as any).reason ?? 'Your truck cannot take this move.');
    }

    // Atomic claim — only succeeds if the booking is still searching.
    const { data, error } = await admin
      .from('bookings')
      .update({
        status: 'assigned',
        assigned_company_id: company_id,
        assigned_team_id: null,
        assigned_driver_profile_id: null,
        dispatch_accepted_at: new Date().toISOString(),
      })
      .eq('id', booking_id)
      .eq('status', 'searching')
      .select('id, short_code, status')
      .single();

    if (error || !data) {
      throw httpError(409, 'Booking was already taken or is no longer available');
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.dispatch_accept',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { company_id },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-dispatch-accept] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
