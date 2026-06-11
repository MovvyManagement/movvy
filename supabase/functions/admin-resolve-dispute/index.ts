// POST /admin-resolve-dispute
// Admin resolves a dispute with optional refund amount + resolution notes.
// Records the resolver, the refund (cents), and flips the status.
//
// Refund is RECORDED here; actual Stripe refund happens in Phase 3.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  dispute_id: z.string().uuid(),
  resolution: z.enum(['resolved_customer', 'resolved_partner', 'closed']),
  refund_cents: z.number().int().min(0).max(1_000_000).default(0),
  notes: z.string().min(1).max(2000),
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
    // Only full admins can refund money. Support staff can resolve with $0.
    const admin = adminClient();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { dispute_id, resolution, refund_cents, notes } = parsed.data;

    if (refund_cents > 0 && user.role !== 'movvy_admin') {
      throw httpError(403, 'Only full admins can issue refunds');
    }

    const { data, error } = await admin
      .from('disputes')
      .update({
        status: resolution,
        refund_cents,
        resolution_notes: notes,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', dispute_id)
      .select('id, booking_id, status, refund_cents')
      .single();

    if (error || !data) throw httpError(404, 'Dispute not found');

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'dispute.resolved',
      entityType: 'dispute',
      entityId: dispute_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { resolution, refund_cents, notes },
    });

    // TODO Phase 3: enqueue Stripe refund for refund_cents

    return jsonResponse({ ok: true, dispute: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-resolve-dispute] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
