// POST /admin-verify-partner
// Admin approves or rejects a partner team OR moving company.
// Flips onboarding_status + sets verified_at; ON APPROVAL also marks the
// associated verification_documents as 'approved'.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  subject_type: z.enum(['team', 'company']),
  subject_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'request_more']),
  notes: z.string().max(500).optional(),
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
    // movvy_support can request more / reject; only full admins can approve.
    await checkRateLimit({
      bucketKey: `user:${user.id}:admin_verify_partner`,
      endpoint: 'admin-verify-partner',
      limit: 60, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { subject_type, subject_id, decision, notes } = parsed.data;

    if (decision === 'approve' && user.role !== 'movvy_admin') {
      throw httpError(403, 'Only full admins can approve');
    }

    const admin = adminClient();

    const table = subject_type === 'team' ? 'partner_teams' : 'companies';
    const patch: Record<string, any> = {};
    if (decision === 'approve') {
      patch.onboarding_status = 'verified';
      patch.verified_at = new Date().toISOString();
    } else if (decision === 'reject') {
      patch.onboarding_status = 'rejected';
    } else {
      patch.onboarding_status = 'in_review';
    }
    if (notes) patch.suspended_reason = notes; // dual-purpose for review notes

    const { data, error } = await admin
      .from(table)
      .update(patch)
      .eq('id', subject_id)
      .select('id, onboarding_status')
      .single();

    if (error || !data) throw httpError(404, `${subject_type} not found`);

    // Approve associated docs too
    if (decision === 'approve') {
      const docCol = subject_type === 'team' ? 'team_id' : 'company_id';
      await admin
        .from('verification_documents')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq(docCol, subject_id)
        .eq('status', 'pending');
    } else if (decision === 'reject') {
      const docCol = subject_type === 'team' ? 'team_id' : 'company_id';
      await admin
        .from('verification_documents')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: notes ?? 'Rejected by admin',
        })
        .eq(docCol, subject_id);
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: `partner.${decision}`,
      entityType: subject_type,
      entityId: subject_id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { notes },
    });

    return jsonResponse({ ok: true, status: data.onboarding_status }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-verify-partner] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
