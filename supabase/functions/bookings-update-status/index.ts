// POST /bookings-update-status
// Driver (assigned) progresses a booking through the status state machine.
// The DB trigger `enforce_booking_status_transition` is the final gate;
// this edge function adds rate limiting + audit log + status timestamps.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

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

    // Stamp the right lifecycle timestamp alongside the status change
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
      .select('id, short_code, status')
      .single();

    if (error) {
      // 22023 = invalid_parameter_value — used by our state-machine trigger
      if (error.code === '22023') throw httpError(400, error.message);
      throw httpError(403, 'Not authorized to update this booking');
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.status_updated',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { new_status, reason },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-update-status] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
