// POST /bookings-accept
// A partner_team or company driver accepts a 'searching' booking.
// Uses a single atomic UPDATE with a status guard so only one accept wins.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  team_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
}).superRefine((b, ctx) => {
  if (!b.team_id && !b.company_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'team_id or company_id required', path: [] });
  }
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // Drivers accept jobs — rate limit to prevent rapid-fire script abuse
    await checkRateLimit({
      bucketKey: `user:${user.id}:bookings_accept`,
      endpoint: 'bookings-accept',
      limit: 30,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, team_id, company_id } = parsed.data;

    const admin = adminClient();

    // ─── Block unverified drivers from accepting jobs ─────────────────────────
    // Background check + ID verification gate. Customers' homes get only
    // people Movvy has actually approved.
    const { data: canTakeJobs } = await admin.rpc('can_take_jobs', {
      p_profile_id: user.id,
    });
    if (canTakeJobs === false) {
      throw httpError(
        403,
        "Your account isn't fully verified yet. Upload your remaining documents and wait for approval before accepting jobs.",
      );
    }

    // ─── Block company drivers from solo-accepting ────────────────────────────
    // Drivers under a company go through the dispatch flow (their dispatcher
    // accepts + assigns). Only company OWNERS / DISPATCHERS can call this
    // endpoint, and only with company_id — never with team_id on behalf of a
    // company. We check the caller's membership unconditionally below.
    const { data: companyMembership } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .is('removed_at', null)
      .maybeSingle();
    if (companyMembership?.role === 'driver') {
      throw httpError(
        403,
        "You're under a company — your dispatcher assigns jobs to you. You don't accept them directly.",
      );
    }

    // Verify the user is an ACTIVE member of the team/company they're accepting
    // on behalf of. status='active' is critical: an Option-C self-join lands in
    // 'pending_approval' — those (and 'rejected') members must never take jobs.
    if (team_id) {
      const { data: m } = await admin
        .from('partner_team_members')
        .select('team_id')
        .eq('team_id', team_id)
        .eq('profile_id', user.id)
        .eq('status', 'active')
        .is('removed_at', null)
        .maybeSingle();
      if (!m) throw httpError(403, 'You are not a member of this team');
    }
    if (company_id) {
      const { data: m } = await admin
        .from('company_members')
        .select('company_id, role')
        .eq('company_id', company_id)
        .eq('profile_id', user.id)
        .eq('status', 'active')
        .is('removed_at', null)
        .maybeSingle();
      if (!m) throw httpError(403, 'You are not a member of this company');

      // Same capacity gate as bookings-dispatch-accept — a crew can't claim a
      // move their truck can't carry, whichever accept path they came through.
      const { data: verdict } = await admin.rpc('org_can_take_booking', {
        p_company_id: company_id,
        p_booking_id: booking_id,
      });
      if (verdict && (verdict as any).ok !== true) {
        throw httpError(400, (verdict as any).reason ?? 'Your truck cannot take this move.');
      }
    }

    // Atomic accept — only succeeds if status is still 'searching'.
    // Use admin client so we don't conflict with RLS on the partner_id columns.
    const { data, error } = await admin
      .from('bookings')
      .update({
        status: 'assigned',
        assigned_team_id: team_id ?? null,
        assigned_company_id: company_id ?? null,
        assigned_driver_profile_id: user.id,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', booking_id)
      .eq('status', 'searching')
      .select('id, short_code, status')
      .single();

    if (error || !data) {
      throw httpError(409, 'Job was already taken or is no longer available');
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.accepted',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { team_id, company_id },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-accept] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
