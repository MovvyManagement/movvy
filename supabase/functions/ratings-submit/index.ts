// POST /ratings-submit
// Either party rates the other after a completed booking. Immutable once submitted.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  party: z.enum(['customer_to_partner', 'partner_to_customer']),
  overall: z.number().int().min(1).max(5),
  professionalism: z.number().int().min(1).max(5).optional(),
  timeliness: z.number().int().min(1).max(5).optional(),
  carefulness: z.number().int().min(1).max(5).optional(),
  communication: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().min(1).max(30)).max(12).optional(),
  comment: z.string().max(1000).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:ratings_submit`,
      endpoint: 'ratings-submit',
      limit: 20,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const input = parsed.data;

    const admin = adminClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id, customer_id, status, assigned_driver_profile_id, assigned_team_id, assigned_company_id')
      .eq('id', input.booking_id)
      .single();
    if (!booking) throw httpError(404, 'Booking not found');
    if (booking.status !== 'completed') {
      throw httpError(400, 'Can only rate completed moves');
    }

    // Determine recipient based on direction + booking assignment
    const recipient: Record<string, string | null> = {
      to_profile_id: null,
      to_team_id: null,
      to_company_id: null,
    };

    if (input.party === 'customer_to_partner') {
      if (booking.customer_id !== user.id) {
        throw httpError(403, 'Only the customer can leave that rating');
      }
      // Prefer team/company-level rating when assigned, else fall back to the driver profile
      if (booking.assigned_team_id) recipient.to_team_id = booking.assigned_team_id;
      else if (booking.assigned_company_id) recipient.to_company_id = booking.assigned_company_id;
      else recipient.to_profile_id = booking.assigned_driver_profile_id;
    } else {
      // partner_to_customer
      if (booking.assigned_driver_profile_id !== user.id) {
        throw httpError(403, 'Only the assigned driver can rate the customer');
      }
      recipient.to_profile_id = booking.customer_id;
    }

    const supabase = userClient(req.headers.get('Authorization'));
    const { data, error } = await supabase
      .from('ratings')
      .insert({
        booking_id: input.booking_id,
        party: input.party,
        from_profile_id: user.id,
        ...recipient,
        overall: input.overall,
        professionalism: input.professionalism ?? null,
        timeliness: input.timeliness ?? null,
        carefulness: input.carefulness ?? null,
        communication: input.communication ?? null,
        tags: input.tags ?? [],
        comment: input.comment ?? null,
      })
      .select('id')
      .single();

    if (error) {
      // Unique violation: already rated
      if (error.code === '23505') throw httpError(409, 'You already rated this move');
      throw httpError(400, error.message);
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'rating.submitted',
      entityType: 'rating',
      entityId: data.id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { booking_id: input.booking_id, party: input.party, overall: input.overall },
    });

    return jsonResponse({ ok: true, rating_id: data.id }, { status: 201 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[ratings-submit] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
