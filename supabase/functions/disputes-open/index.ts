// POST /disputes-open
// Customer (or assigned crew) opens a dispute on a booking.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  kind: z.enum(['damage', 'late', 'no_show', 'poor_service', 'overcharge', 'other']),
  severity: z.enum(['low', 'medium', 'high']).default('low'),
  summary: z.string().trim().min(10).max(2000),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:disputes_open`,
      endpoint: 'disputes-open',
      limit: 5, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, kind, severity, summary } = parsed.data;

    const admin = adminClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, customer_id, assigned_driver_profile_id, assigned_team_id, assigned_company_id, status')
      .eq('id', booking_id)
      .single();

    if (!booking) throw httpError(404, 'Booking not found');

    const isCustomer = booking.customer_id === user.id;
    const isDriver = booking.assigned_driver_profile_id === user.id;
    if (!isCustomer && !isDriver) throw httpError(403, 'Not a participant in this booking');

    // Determine the "against" party
    const againstProfile = isCustomer ? booking.assigned_driver_profile_id : booking.customer_id;
    const againstCompany = isCustomer ? booking.assigned_company_id : null;

    const supabase = userClient(req.headers.get('Authorization'));
    const { data, error } = await supabase
      .from('disputes')
      .insert({
        booking_id,
        opened_by: user.id,
        against_profile_id: againstProfile,
        against_company_id: againstCompany,
        kind,
        severity,
        summary,
        status: 'open',
      })
      .select('id, kind, status')
      .single();

    if (error) throw httpError(400, error.message);

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'dispute.opened',
      entityType: 'dispute',
      entityId: data.id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { booking_id, kind, severity },
    });

    return jsonResponse({ ok: true, dispute: data }, { status: 201 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[disputes-open] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
