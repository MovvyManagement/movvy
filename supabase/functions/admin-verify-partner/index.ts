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
import { sendBrandedEmail } from '../_shared/email.ts';
import {
  moverApproved,
  moverApplicationDeclined,
} from '../_shared/emails/index.ts';

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

    // ─── Branded "you're approved" / "we won't be moving forward" email ────
    // Fire-and-forget. `request_more` doesn't send anything here — that
    // case is for "the application is back in_review" which is handled by
    // in-app notifications, and any *specific* doc flag goes through a
    // separate endpoint that calls docNeedsResubmission directly.
    if (decision === 'approve' || decision === 'reject') {
      try {
        const ownerProfile = await fetchPartnerOwnerProfile(
          admin,
          subject_type,
          subject_id,
        );

        // In-app notification — shows in the partner's notification bell the
        // instant they're approved/declined, even if they miss the email.
        if (ownerProfile?.id) {
          await admin.from('notifications').insert({
            profile_id: ownerProfile.id,
            channel: 'in_app',
            category: decision === 'approve' ? 'partner.approved' : 'partner.declined',
            title: decision === 'approve' ? "You're approved! 🎉" : 'Application update',
            body: decision === 'approve'
              ? 'Welcome to the Movvy crew. Sign in with the email/phone and password you used to apply, then set your availability and payout details to start getting jobs.'
              : (notes ?? 'Your application did not meet our current onboarding criteria.'),
            data: { subject_type, subject_id },
          }).catch?.((e: unknown) => console.warn('[admin-verify-partner] notify failed', e));
        }

        if (ownerProfile?.email) {
          const template =
            decision === 'approve'
              ? moverApproved({
                  fullName: ownerProfile.full_name,
                  appUrl: 'https://movvy.ca/app',
                })
              : moverApplicationDeclined({
                  fullName: ownerProfile.full_name,
                  reason: notes ?? 'Your application did not meet our current onboarding criteria.',
                  reapplyAfter: null,
                });
          sendBrandedEmail({
            to: ownerProfile.email,
            template,
          }).catch((e) => console.warn('[admin-verify-partner] email send failed', e));
        }
      } catch (emailErr) {
        console.warn('[admin-verify-partner] notify/email setup failed (non-fatal)', emailErr);
      }
    }

    return jsonResponse({ ok: true, status: data.onboarding_status }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-verify-partner] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// ─── Helper: resolve owner contact ───────────────────────────────────────────
// Pulls the "primary contact" profile for a team or company so the approval /
// decline email goes to the right inbox. For teams we use the first member
// (small operators are typically solo). For companies we prefer the owner.

async function fetchPartnerOwnerProfile(
  admin: ReturnType<typeof adminClient>,
  subjectType: 'team' | 'company',
  subjectId: string,
): Promise<{ id: string | null; email: string | null; full_name: string | null } | null> {
  if (subjectType === 'team') {
    const { data } = await admin
      .from('partner_team_members')
      .select('profiles!partner_team_members_profile_id_fkey(id, email, full_name)')
      .eq('team_id', subjectId)
      .eq('status', 'active')
      .is('removed_at', null)
      .limit(1)
      .maybeSingle();
    return ((data as any)?.profiles ?? null) as
      | { id: string | null; email: string | null; full_name: string | null }
      | null;
  }
  // company
  const { data } = await admin
    .from('company_members')
    .select('role, profiles!company_members_profile_id_fkey(id, email, full_name)')
    .eq('company_id', subjectId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();
  return ((data as any)?.profiles ?? null) as
    | { id: string | null; email: string | null; full_name: string | null }
    | null;
}
