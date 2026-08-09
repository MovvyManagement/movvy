// POST /admin-reassign-booking
// Admin reassigns a booking to a different driver / team / company.
// Bypasses the normal "atomic-on-searching" guard since admin overrides.
//
// A move can only be reassigned BEFORE it starts. The moment a crew presses
// "I've left HQ" (status → on_the_way) the job belongs to whoever pressed it:
// they finish it, or they call Movvy support. Reassigning after that point is
// refused outright.
//
// This used to blindly stamp status:'assigned' with no check of where the move
// actually was, so reassigning a booking already in_transit rewound it to
// 'assigned' — stranding a crew mid-drive with a customer watching a move that
// had apparently un-started, and orphaning the tracking session and the
// started_at the final bill is computed from.

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

    // ── Only before the wheels move ─────────────────────────────────────────
    // Everything up to and including 'confirmed' is still on paper: nobody has
    // driven anywhere, so handing the job to another crew costs nothing.
    const REASSIGNABLE = ['draft', 'pending', 'searching', 'assigned', 'confirmed'];
    const { data: current, error: readErr } = await admin
      .from('bookings')
      .select('id, short_code, status')
      .eq('id', booking_id)
      .single();
    if (readErr || !current) throw httpError(404, 'Booking not found');

    if (['completed', 'cancelled', 'failed'].includes(current.status)) {
      throw httpError(409, `This move is already ${current.status} and can't be reassigned.`);
    }
    if (!REASSIGNABLE.includes(current.status)) {
      // 'on_the_way' onward — the crew has left HQ and owns the job.
      throw httpError(
        409,
        "This crew has already left HQ, so the move can't be reassigned. They need to " +
        'finish it, or contact Movvy support to have it cancelled and rebooked.',
      );
    }

    const patch: Record<string, any> = {
      assigned_driver_profile_id: driver_profile_id ?? null,
      assigned_team_id: team_id ?? null,
      assigned_company_id: company_id ?? null,
      assigned_at: new Date().toISOString(),
      // Reset to 'assigned' so the new crew can take action. Safe now that we
      // know the move hasn't started — it can only ever move a booking back
      // from 'confirmed', never rewind one that's underway.
      status: 'assigned',
    };

    const { data, error } = await admin
      .from('bookings')
      .update(patch)
      .eq('id', booking_id)
      // Re-assert the status we just read. If the crew pressed "left HQ" in the
      // gap between the check and the write, this matches nothing and we bail
      // rather than clobbering a move that started a moment ago.
      .eq('status', current.status)
      .select('id, short_code, status')
      .single();

    if (error || !data) {
      throw httpError(409, 'This move just changed status — reload and try again.');
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'booking.reassigned',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: {
        driver_profile_id, team_id, company_id, reason,
        from_status: current.status,
      },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-reassign-booking] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
