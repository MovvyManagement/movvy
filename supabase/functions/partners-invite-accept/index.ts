// =============================================================================
// POST /partners-invite-accept — Option C join flow (open code, owner approves)
//
// Anyone with a valid team/company invite code can sign up and request to
// join. The membership row is created with status='pending_approval' and
// the owner (or dispatcher for companies) gets an in-app notification to
// approve or reject via /partners-approve-join.
//
// Behavior:
//   • invite_code + email/phone + name + password required
//   • If a partner_invites row exists for the same email/phone + team/company,
//     we use its `role`. Otherwise default the new member to 'driver' for
//     teams and 'driver' for companies (owner can promote to dispatcher after).
//   • Duplicate pending requests are blocked by the partner_team_members_one_pending
//     unique index.
//   • Duplicate active membership is a "welcome back" — return signed_in=false
//     so the app tells them to just log in.
//
// Rate-limited by IP (10 attempts / 10 min) — the invite code is 6 chars so
// brute-force protection matters even though the pool is 30^6 = 729M.
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
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Email = z.string().trim().toLowerCase().email();
const PhoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required');

const Body = z
  .object({
    invite_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(TM|CO)-[A-Z0-9]{6}$/, 'Invalid code format'),
    email: Email.optional(),
    phone: PhoneE164.optional(),
    password: z.string().min(10).max(128),
    full_name: z.string().trim().min(2).max(120),
  })
  .refine((v) => !!v.email !== !!v.phone, {
    message: 'Provide exactly one of email or phone',
  });

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    // Rate-limit by IP to defend the invite-code brute force ceiling.
    const ip = clientIp(req);
    await checkRateLimit({
      bucketKey: `ip:${ip}:partners_invite_accept`,
      endpoint: 'partners-invite-accept',
      limit: 10,
      windowSeconds: 600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { invite_code, email, phone, password, full_name } = parsed.data;

    const admin = adminClient();

    // ─── 1. Resolve the code → team or company ───────────────────────────────
    const { data: team } = await admin
      .from('partner_teams')
      .select('id, display_name')
      .eq('invite_code', invite_code)
      .maybeSingle();

    const { data: company } = team
      ? { data: null as any }
      : await admin
          .from('companies')
          .select('id, display_name')
          .eq('invite_code', invite_code)
          .maybeSingle();

    if (!team && !company) {
      throw httpError(404, "We couldn't find a team or company with that code. Double-check it.");
    }

    // Best default for a fresh code-only signup — owner can promote to
    // dispatcher/mover later from their crew UI.
    const defaultRole = 'driver';
    const targetName = team?.display_name ?? company?.display_name;

    // If there IS a matching partner_invites row for this contact, prefer
    // whatever role it says + mark it accepted at approval time.
    let preInviteRole: string | null = null;
    let preInviteId: string | null = null;
    if (email || phone) {
      const matchQuery = admin
        .from('partner_invites')
        .select('id, role')
        .in('status', ['pending', 'sent']);
      if (team) matchQuery.eq('team_id', team.id);
      if (company) matchQuery.eq('company_id', company.id);
      if (email) matchQuery.eq('email', email);
      if (phone) matchQuery.eq('phone', phone);
      const { data: inviteMatch } = await matchQuery.maybeSingle();
      if (inviteMatch) {
        preInviteRole = inviteMatch.role;
        preInviteId = inviteMatch.id;
      }
    }
    const memberRole = preInviteRole ?? defaultRole;

    // ─── 2. Create (or look up) the auth user ────────────────────────────────
    let userId: string | null = null;
    let createdNew = false;

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, email, phone')
      .or(email ? `email.eq.${email}` : `phone.eq.${phone}`)
      .maybeSingle();

    if (existingProfile?.id) {
      // ─── Prove you own this account before we bind anything to it ─────────
      // Reusing an existing profile on the strength of a submitted email/phone
      // alone means anyone holding a crew code — which crews are told to
      // broadcast — plus someone's email could put that person on their roster,
      // stamp partner_registered_at on their identity (defeating the
      // customer/partner separation in 0086), and expose their name, email and
      // phone to the org owner via pending_join_requests.
      //
      // The password submitted with the join is what we check it against. The
      // sibling endpoint partners-invite-respond does the equivalent by
      // matching the invite's contact to the CALLER's own profile.
      const { data: signedIn, error: pwErr } = await admin.auth.signInWithPassword(
        email ? { email, password } : { phone: phone!, password },
      );
      if (pwErr || signedIn?.user?.id !== existingProfile.id) {
        throw httpError(
          403,
          'That email or phone already has a Movvy account. Enter its password to join with it, or sign in and use the crew code from your profile.',
        );
      }
      userId = existingProfile.id;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        phone,
        password,
        email_confirm: !!email,
        phone_confirm: !!phone,
        user_metadata: {
          full_name,
          role: memberRole === 'driver' ? 'driver' : memberRole,
          invited_from: team ? 'team' : 'company',
          invite_code,
        },
      });
      if (cErr || !created?.user) {
        console.error('[partners-invite-accept] createUser', cErr);
        throw httpError(400, cErr?.message ?? 'Could not create account');
      }
      userId = created.user.id;
      createdNew = true;
    }

    // ─── 3. Check existing membership ────────────────────────────────────────
    if (team) {
      const { data: existing } = await admin
        .from('partner_team_members')
        .select('id, status')
        .eq('team_id', team.id)
        .eq('profile_id', userId)
        .maybeSingle();
      if (existing) {
        if (existing.status === 'active') {
          return jsonResponse(
            {
              ok: true,
              already_member: true,
              signed_in: false,
              role: memberRole,
              team_id: team.id,
              message: `You're already on the ${targetName} roster. Sign in to continue.`,
            },
            { status: 200 },
            cors,
          );
        }
        if (existing.status === 'pending_approval') {
          return jsonResponse(
            {
              ok: true,
              pending_approval: true,
              signed_in: false,
              role: memberRole,
              team_id: team.id,
              message: `You've already requested to join ${targetName}. Sign in to track your status.`,
            },
            { status: 200 },
            cors,
          );
        }
        if (existing.status === 'rejected' || existing.status === 'removed') {
          throw httpError(
            403,
            `${targetName} previously ${existing.status} your access. Contact them directly to re-request.`,
          );
        }
      }
    } else if (company) {
      const { data: existing } = await admin
        .from('company_members')
        .select('id, status')
        .eq('company_id', company.id)
        .eq('profile_id', userId)
        .maybeSingle();
      if (existing) {
        if (existing.status === 'active') {
          return jsonResponse(
            {
              ok: true,
              already_member: true,
              signed_in: false,
              role: memberRole,
              company_id: company.id,
              message: `You're already on the ${targetName} roster. Sign in to continue.`,
            },
            { status: 200 },
            cors,
          );
        }
        if (existing.status === 'pending_approval') {
          return jsonResponse(
            {
              ok: true,
              pending_approval: true,
              signed_in: false,
              role: memberRole,
              company_id: company.id,
              message: `You've already requested to join ${targetName}. Sign in to track your status.`,
            },
            { status: 200 },
            cors,
          );
        }
        if (existing.status === 'rejected' || existing.status === 'removed') {
          throw httpError(
            403,
            `${targetName} previously ${existing.status} your access. Contact them directly to re-request.`,
          );
        }
      }
    }

    // ─── 4. Insert pending_approval membership ───────────────────────────────
    if (team) {
      const { error: insErr } = await admin.from('partner_team_members').insert({
        team_id: team.id,
        profile_id: userId,
        role: memberRole,
        status: 'pending_approval',
        // Constraint requires drivers to have a license number. Placeholder
        // until the owner collects the real one during approval — the
        // approval UI prompts for it before flipping status → active.
        driver_license_number: memberRole === 'driver' ? 'PENDING' : null,
      });
      if (insErr) {
        console.error('[partners-invite-accept] member insert', insErr);
        throw httpError(400, `Could not create membership: ${insErr.message}`);
      }
    } else if (company) {
      const { error: insErr } = await admin.from('company_members').insert({
        company_id: company.id,
        profile_id: userId,
        role: memberRole,
        status: 'pending_approval',
        driver_license_number: memberRole === 'driver' ? 'PENDING' : null,
      });
      if (insErr) {
        console.error('[partners-invite-accept] member insert', insErr);
        throw httpError(400, `Could not create membership: ${insErr.message}`);
      }
    }

    // ─── 4b. Stamp the PARTNER side ─────────────────────────────────────────
    // Joining a crew by code IS partner registration (migration 0086). Without
    // this the person we just added to a roster would be turned away at the
    // partner sign-in, because the two sides are separate registrations and
    // this path never touches the signup form that normally stamps it.
    {
      const { error: sideErr } = await admin
        .from('profiles')
        .update({ partner_registered_at: new Date().toISOString() })
        .eq('id', userId)
        .is('partner_registered_at', null);
      if (sideErr) {
        console.error('[partners-invite-accept] partner side stamp', sideErr);
      }
    }

    // Mark the pre-invite (if any) as consumed
    if (preInviteId) {
      await admin
        .from('partner_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', preInviteId);
    }

    // ─── 5. Notify the owner(s) ──────────────────────────────────────────────
    try {
      let ownerIds: string[] = [];
      if (team) {
        const { data } = await admin
          .from('partner_team_members')
          .select('profile_id')
          .eq('team_id', team.id)
          .eq('role', 'driver')
          .eq('status', 'active')
          .is('removed_at', null);
        ownerIds = (data ?? []).map((r: any) => r.profile_id);
      } else if (company) {
        const { data } = await admin
          .from('company_members')
          .select('profile_id')
          .eq('company_id', company.id)
          .in('role', ['owner', 'dispatcher'])
          .eq('status', 'active')
          .is('removed_at', null);
        ownerIds = (data ?? []).map((r: any) => r.profile_id);
      }

      if (ownerIds.length > 0) {
        const rows = ownerIds.flatMap((profile_id) => [
          {
            profile_id,
            channel: 'in_app' as const,
            category: 'partner.join_request',
            title: 'New driver requested to join',
            body: `${full_name} wants to join ${targetName}. Review + approve in your crew.`,
            data: {
              team_id: team?.id ?? null,
              company_id: company?.id ?? null,
              applicant_profile_id: userId,
              applicant_name: full_name,
            },
          },
          {
            profile_id,
            channel: 'push' as const,
            category: 'partner.join_request',
            title: 'New driver requested to join',
            body: `${full_name} wants to join ${targetName}.`,
            data: {
              team_id: team?.id ?? null,
              company_id: company?.id ?? null,
              applicant_profile_id: userId,
            },
          },
        ]);
        await admin.from('notifications').insert(rows);
      }
    } catch (nErr) {
      console.warn('[partners-invite-accept] owner notify failed (non-fatal)', nErr);
    }

    await audit({
      actorId: userId,
      actorRole: memberRole,
      action: 'partners.join_requested',
      entityType: team ? 'partner_team' : 'company',
      entityId: team?.id ?? company?.id ?? null,
      ip,
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { created_new: createdNew, target: targetName },
    });

    return jsonResponse(
      {
        ok: true,
        pending_approval: true,
        created_new: createdNew,
        role: memberRole,
        team_id: team?.id ?? null,
        company_id: company?.id ?? null,
        target_name: targetName,
        message: createdNew
          ? `Account created. ${targetName}'s owner will review your request — sign in to check your status.`
          : `Join request sent. ${targetName}'s owner will review — sign in to check your status.`,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.message }, { status: e.status }, cors);
    }
    console.error('[partners-invite-accept] unexpected', e);
    return jsonResponse({ error: 'Internal error' }, { status: 500 }, cors);
  }
});
