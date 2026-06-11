// POST /admin-suspend-user
// Admin suspends or reinstates a user. Suspended users are blocked at requireAuth.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  profile_id: z.string().uuid(),
  action: z.enum(['suspend', 'reinstate']),
  reason: z.string().max(500).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    if (user.role !== 'movvy_admin') throw httpError(403, 'Full admins only');

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { profile_id, action, reason } = parsed.data;

    if (profile_id === user.id) throw httpError(400, 'You cannot suspend yourself');

    const admin = adminClient();
    const patch = action === 'suspend'
      ? { is_suspended: true, suspended_at: new Date().toISOString(), suspended_reason: reason ?? 'Suspended by admin' }
      : { is_suspended: false, suspended_at: null, suspended_reason: null };

    const { data, error } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', profile_id)
      .select('id, is_suspended, role')
      .single();

    if (error || !data) throw httpError(404, 'Profile not found');

    await audit({
      actorId: user.id, actorRole: user.role,
      action: `user.${action}d`,
      entityType: 'profile',
      entityId: profile_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { reason, target_role: data.role },
    });

    return jsonResponse({ ok: true, suspended: data.is_suspended }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-suspend-user] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
