// POST /partners-broadcast
// Notify every eligible partner in a booking's city that a new job is available.
//
// Eligibility (kept simple for v1):
//   - Verified partner team OR company in the same city_id
//   - Not suspended
//
// Future (Phase 6+): filter by service_radius_km, current schedule conflicts,
// avoid pinging partners that already declined this booking.
//
// Inserts a row into `notifications` for every recipient. The trigger-based
// status notification (notify_customer_on_status_change) handles the customer
// side already; this one is purely outbound to partners.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    // Customer of the booking or admin can broadcast.
    await checkRateLimit({
      bucketKey: `user:${user.id}:partners_broadcast`,
      endpoint: 'partners-broadcast',
      limit: 20, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id } = parsed.data;

    const admin = adminClient();

    const { data: booking } = await admin
      .from('bookings')
      .select('id, short_code, customer_id, city_id, status, move_type, pickup_city, dropoff_city, scheduled_for_date, price_total_cents, driver_total_cents')
      .eq('id', booking_id)
      .single();
    if (!booking) throw httpError(404, 'Booking not found');

    const isCustomer = booking.customer_id === user.id;
    const isAdmin = ['movvy_admin', 'movvy_support'].includes(user.role);
    if (!isCustomer && !isAdmin) throw httpError(403, 'Not authorized for this booking');

    if (booking.status !== 'searching') {
      return jsonResponse(
        { ok: false, reason: 'booking_not_searching', status: booking.status },
        { status: 200 }, cors,
      );
    }

    // Find eligible recipients: verified partner teams + companies in the same city.
    // For teams → notify both members. For companies → notify owner + dispatchers.
    const [teamRes, companyRes] = await Promise.all([
      admin
        .from('partner_team_members')
        .select('profile_id, partner_teams!inner(id, primary_city_id, onboarding_status)')
        .eq('partner_teams.primary_city_id', booking.city_id)
        .eq('partner_teams.onboarding_status', 'verified')
        .eq('status', 'active')
        .is('removed_at', null),
      admin
        .from('company_members')
        .select('profile_id, role, companies!inner(id, primary_city_id, onboarding_status)')
        .eq('companies.primary_city_id', booking.city_id)
        .eq('companies.onboarding_status', 'verified')
        .in('role', ['owner', 'dispatcher'])
        .eq('status', 'active')
        .is('removed_at', null),
    ]);

    const recipientIds = new Set<string>();
    for (const row of teamRes.data ?? []) recipientIds.add((row as any).profile_id);
    for (const row of companyRes.data ?? []) recipientIds.add((row as any).profile_id);

    if (recipientIds.size === 0) {
      return jsonResponse({ ok: true, recipients: 0, reason: 'no_eligible_partners' }, { status: 200 }, cors);
    }

    const driverDollars = Math.round((booking.driver_total_cents ?? 0) / 100);
    const rows = Array.from(recipientIds).map((profile_id) => ({
      profile_id,
      channel: 'in_app' as const,
      category: 'job.available',
      title: 'New job available',
      body: `${booking.pickup_city} → ${booking.dropoff_city ?? 'in-home'} · est. $${driverDollars} payout`,
      data: { booking_id: booking.id, short_code: booking.short_code, move_type: booking.move_type },
    }));

    const { error: insertErr } = await admin.from('notifications').insert(rows);
    if (insertErr) {
      console.error('[partners-broadcast] notifications insert failed', insertErr);
      throw httpError(500, 'Could not broadcast to partners');
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'booking.broadcast',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { recipient_count: recipientIds.size },
    });

    return jsonResponse(
      { ok: true, recipients: recipientIds.size },
      { status: 200 }, cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[partners-broadcast] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
