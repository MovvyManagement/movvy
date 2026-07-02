// =============================================================================
// POST /partners-approve-join
//
// The team-operator (partner_teams driver) or company owner/dispatcher
// approves or rejects a pending_approval join request.
//
// Body:
//   {
//     subject_type: 'team' | 'company',
//     subject_id: uuid,           // team or company id
//     applicant_profile_id: uuid, // the pending member's profile
//     decision: 'approve' | 'reject',
//     reason?: string             // required for reject, shown to applicant
//   }
//
// Auth: caller must be an *active* owner of the target team/company.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient,
  audit,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
  requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  subject_type: z.enum(['team', 'company']),
  subject_id: z.string().uuid(),
  applicant_profile_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:partners_approve_join`,
      endpoint: 'partners-approve-join',
      limit: 60,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { subject_type, subject_id, applicant_profile_id, decision, reason } = parsed.data;

    if (decision === 'reject' && !reason?.trim()) {
      throw httpError(400, 'A short reason is required when rejecting.');
    }

    const admin = adminClient();

    // ─── 1. Authorize the caller ─────────────────────────────────────────────
    // Team → the team's driver-operator (role='driver', status='active')
    // Company → owner or dispatcher (status='active')
    let isAuthorized = false;
    if (subject_type === 'team') {
      const { data } = await admin
        .from('partner_team_members')
        .select('id')
        .eq('team_id', subject_id)
        .eq('profile_id', user.id)
        .eq('role', 'driver')
        .eq('status', 'active')
        .is('removed_at', null)
        .maybeSingle();
      isAuthorized = !!data;
    } else {
      const { data } = await admin
        .from('company_members')
        .select('id')
        .eq('company_id', subject_id)
        .eq('profile_id', user.id)
        .in('role', ['owner', 'dispatcher'])
        .eq('status', 'active')
        .is('removed_at', null)
        .maybeSingle();
      isAuthorized = !!data;
    }
    if (!isAuthorized) {
      throw httpError(403, 'You are not authorized to approve join requests for this team or company.');
    }

    // ─── 2. Verify + update the pending member ──────────────────────────────
    const table = subject_type === 'team' ? 'partner_team_members' : 'company_members';
    const scopeCol = subject_type === 'team' ? 'team_id' : 'company_id';

    const { data: pendingRow } = await admin
      .from(table)
      .select('id, status, role')
      .eq(scopeCol, subject_id)
      .eq('profile_id', applicant_profile_id)
      .eq('status', 'pending_approval')
      .maybeSingle();
    if (!pendingRow) {
      throw httpError(404, 'No pending join request found. It may have been withdrawn or already resolved.');
    }

    const now = new Date().toISOString();
    const patch: Record<string, any> =
      decision === 'approve'
        ? {
            status: 'active',
            approved_at: now,
            approved_by_profile_id: user.id,
            accepted_at: now, // Also stamp accepted_at so downstream "is-member" checks work
          }
        : {
            status: 'rejected',
            rejected_at: now,
            rejected_by_profile_id: user.id,
            rejected_reason: reason ?? null,
          };

    const { error: uErr } = await admin
      .from(table)
      .update(patch)
      .eq('id', pendingRow.id);
    if (uErr) {
      console.error('[partners-approve-join] update failed', uErr);
      throw httpError(500, 'Could not update membership');
    }

    // ─── 3. Get applicant + target names for the notification ────────────────
    const [
      { data: applicant },
      { data: target },
    ] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', applicant_profile_id).maybeSingle(),
      subject_type === 'team'
        ? admin.from('partner_teams').select('display_name').eq('id', subject_id).maybeSingle()
        : admin.from('companies').select('display_name').eq('id', subject_id).maybeSingle(),
    ]);
    const applicantName = applicant?.full_name ?? 'The applicant';
    const targetName = target?.display_name ?? (subject_type === 'team' ? 'the team' : 'the company');

    // ─── 4. Notify the applicant ────────────────────────────────────────────
    const title =
      decision === 'approve'
        ? `You're in — welcome to ${targetName}`
        : `Your ${targetName} join request was declined`;
    const body =
      decision === 'approve'
        ? `Open Movvy — you can start seeing jobs now.`
        : reason ?? 'The team decided not to move forward at this time.';

    const rows = [
      {
        profile_id: applicant_profile_id,
        channel: 'in_app' as const,
        category: `partner.${decision}`,
        title,
        body,
        data: {
          decision,
          subject_type,
          subject_id,
          team_id: subject_type === 'team' ? subject_id : null,
          company_id: subject_type === 'company' ? subject_id : null,
        },
      },
      {
        profile_id: applicant_profile_id,
        channel: 'push' as const,
        category: `partner.${decision}`,
        title,
        body,
        data: {
          decision,
          subject_type,
          subject_id,
        },
      },
    ];
    await admin.from('notifications').insert(rows).catch((e) =>
      console.warn('[partners-approve-join] notify applicant failed', e),
    );

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: `partners.join_${decision}d`,
      entityType: subject_type === 'team' ? 'partner_team' : 'company',
      entityId: subject_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { applicant_profile_id, reason, applicant_name: applicantName },
    });

    return jsonResponse(
      {
        ok: true,
        decision,
        applicant_name: applicantName,
        target_name: targetName,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.message }, { status: e.status }, cors);
    }
    console.error('[partners-approve-join] unexpected', e);
    return jsonResponse({ error: 'Internal error' }, { status: 500 }, cors);
  }
});
