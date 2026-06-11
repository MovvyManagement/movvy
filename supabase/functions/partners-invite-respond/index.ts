// =============================================================================
// POST /partners-invite-respond
//
// Called by the in-app popup when an already-signed-in driver chooses
// Accept or Decline on a pending invite. Different from
// partners-invite-accept (which creates a brand-new auth user).
//
// Auth:
//   • requires a signed-in user
//   • the user's profile email/phone MUST match the invite's email/phone —
//     otherwise we 403. Prevents a malicious user from accepting someone
//     else's invite even if they somehow know the invite id.
//
// On accept:
//   • inserts the matching company_members / partner_team_members row
//   • marks the invite status='accepted' + accepted_by_profile_id
//
// On decline:
//   • marks the invite status='declined'
//   • no membership row created
//
// Body: { invite_id: uuid, decision: 'accept' | 'decline' }
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
  invite_id: z.string().uuid(),
  decision: z.enum(['accept', 'decline']),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:partners_invite_respond`,
      endpoint: 'partners-invite-respond',
      limit: 30,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { invite_id, decision } = parsed.data;

    const admin = adminClient();

    // Load the invite
    const { data: invite, error: iErr } = await admin
      .from('partner_invites')
      .select('id, team_id, company_id, role, email, phone, status, expires_at')
      .eq('id', invite_id)
      .maybeSingle();
    if (iErr || !invite) throw httpError(404, 'Invite not found');

    // Already resolved? Idempotent no-op so the popup doesn't error out on
    // a double-tap.
    if (invite.status === 'accepted' || invite.status === 'declined') {
      return jsonResponse({ ok: true, status: invite.status, already_resolved: true }, { status: 200 }, cors);
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await admin.from('partner_invites').update({ status: 'expired' }).eq('id', invite_id);
      throw httpError(410, 'This invite has expired. Ask your team owner to send a new one.');
    }

    // Verify caller is the invitee by matching their profile email/phone
    // against what the owner registered them with.
    const { data: profile } = await admin
      .from('profiles')
      .select('email, phone')
      .eq('id', user.id)
      .single();
    if (!profile) throw httpError(403, 'No profile');

    const profileEmail = (profile.email ?? '').toLowerCase();
    const profilePhone = profile.phone ?? '';
    const inviteEmail = (invite.email ?? '').toLowerCase();
    const invitePhone = invite.phone ?? '';
    const matches =
      (!!inviteEmail && inviteEmail === profileEmail) ||
      (!!invitePhone && invitePhone === profilePhone);
    if (!matches) {
      throw httpError(
        403,
        "This invite was sent to a different email/phone. Sign in with the contact your team owner registered.",
      );
    }

    if (decision === 'decline') {
      await admin
        .from('partner_invites')
        .update({ status: 'declined' })
        .eq('id', invite_id);

      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: 'partners.invite_declined',
        entityType: invite.team_id ? 'partner_team' : 'company',
        entityId: invite.team_id ?? invite.company_id,
        ip: clientIp(req),
        ua: req.headers.get('user-agent') ?? undefined,
        payload: { invite_id },
      });

      return jsonResponse({ ok: true, status: 'declined' }, { status: 200 }, cors);
    }

    // Accept path — link to the right membership table
    if (invite.team_id) {
      const { error: linkErr } = await admin
        .from('partner_team_members')
        .insert({
          team_id: invite.team_id,
          profile_id: user.id,
          role: invite.role === 'driver' ? 'driver' : 'mover',
          accepted_at: new Date().toISOString(),
        });
      if (linkErr && !linkErr.message?.includes('duplicate')) {
        console.error('[partners-invite-respond] team link', linkErr);
        throw httpError(500, 'Could not join the team');
      }
    } else if (invite.company_id) {
      const { error: linkErr } = await admin
        .from('company_members')
        .insert({
          company_id: invite.company_id,
          profile_id: user.id,
          role: invite.role === 'dispatcher' ? 'dispatcher' : 'driver',
          accepted_at: new Date().toISOString(),
        });
      if (linkErr && !linkErr.message?.includes('duplicate')) {
        console.error('[partners-invite-respond] company link', linkErr);
        throw httpError(500, 'Could not join the company');
      }
    }

    await admin
      .from('partner_invites')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by_profile_id: user.id,
      })
      .eq('id', invite_id);

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'partners.invite_accepted',
      entityType: invite.team_id ? 'partner_team' : 'company',
      entityId: invite.team_id ?? invite.company_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { invite_id },
    });

    return jsonResponse(
      {
        ok: true,
        status: 'accepted',
        team_id: invite.team_id,
        company_id: invite.company_id,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[partners-invite-respond] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
