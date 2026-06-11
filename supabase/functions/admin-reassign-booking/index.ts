// POST /admin-reassign-booking
// Admin reassigns a booking to a different driver / team / company.
// Bypasses the normal "atomic-on-searching" guard since admin overrides.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  driver_profile_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    if (!['movvy_admin', 'movvy_support'].includes(user.role)) {
      throw httpError(403, 'Admins only');
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, driver_profile_id, team_id, company_id, reason } = parsed.data;

    if (!driver_profile_id && !team_id && !company_id) {
      throw httpError(400, 'Must specify at least one of: driver, team, or company');
    }

    const admin = adminClient();
    const patch: Record<string, any> = {
      assigned_driver_profile_id: driver_profile_id ?? null,
      assigned_team_id: team_id ?? null,
      assigned_company_id: company_id ?? null,
      assigned_at: new Date().toISOString(),
      // Reset to 'assigned' so the new driver can take action
      status: 'assigned',
    };

    const { data, error } = await admin
      .from('bookings')
      .update(patch)
      .eq('id', booking_id)
      .select('id, short_code, status')
      .single();

    if (error || !data) throw httpError(404, 'Booking not found');

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'booking.reassigned',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { driver_profile_id, team_id, company_id, reason },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-reassign-booking] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
