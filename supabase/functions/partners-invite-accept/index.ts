// =============================================================================
// POST /partners-invite-accept
//
// Public endpoint (no auth required) used by the partner-join screen on the
// welcome flow. Validates that (invite_code, email|phone) matches a pending
// invite, creates the auth user, inserts the partner_team_members or
// company_members row, marks the invite accepted.
//
// Returns either:
//   • { ok: true, signed_in: true, role }            ← legacy account, already
//   • { ok: true, signed_in: false, role, email|phone, message }
//                                                      ← new account, the UI
//                                                        prompts them to log in
//
// The endpoint is rate-limited per IP to prevent invite-code brute force.
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
    invite_code: z.string().trim().toUpperCase().regex(/^(TM|CO)-[A-Z0-9]{6}$/, 'Invalid code format'),
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
    // Rate-limit by IP — invite codes are short, must protect against brute force.
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

    // ─── 1. Resolve the invite via the RPC ───────────────────────────────────
    const { data: matches, error: rpcErr } = await admin.rpc('find_partner_invite', {
      p_invite_code: invite_code,
      p_email: email ?? null,
      p_phone: phone ?? null,
    });
    if (rpcErr) {
      console.error('[partners-invite-accept] rpc error', rpcErr);
      throw httpError(500, 'Could not validate invite');
    }
    const match = (matches as any[])?.[0];
    if (!match) {
      // Same generic error whether the code is wrong or the contact doesn't
      // match — don't leak which side of the check failed.
      throw httpError(404, "We couldn't find that invite. Check the code and the email/phone you were invited with.");
    }

    const { invite_id, team_id, company_id, role } = match;

    // ─── 2. Create (or look up) the auth user ────────────────────────────────
    // If a user with this email/phone already exists, just link them — don't
    // try to recreate the account.

    let userId: string | null = null;
    let createdNew = false;

    // 2a. Look up existing
    const lookupKey = email ?? phone!;
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .or(
        email
          ? `email.eq.${email}`
          : `phone.eq.${phone}`,
      )
      .maybeSingle();

    if (existing?.id) {
      userId = existing.id;
    } else {
      // 2b. Create via admin API — also sends the verification email/SMS
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: email,
        phone: phone,
        password,
        email_confirm: !!email, // skip email confirm — they came through an invite
        phone_confirm: !!phone,
        user_metadata: {
          full_name,
          role: role === 'driver' ? 'driver' : role === 'mover' ? 'mover' : 'company_dispatcher',
          invited_from: team_id ? 'team' : 'company',
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

    // ─── 3. DO NOT auto-link to team/company.
    //
    // We used to insert the membership row here so the invite was
    // "accepted" the moment the account was created. New flow: the
    // account is created, then the driver signs in, then the in-app
    // popup (InviteAcceptHost + partners-invite-respond) lets them
    // explicitly Accept or Decline. Leaves the invite in 'sent' status
    // so the popup picks it up; the response edge fn does the linking.

    await audit({
      actorId: userId,
      actorRole: role,
      action: 'partners.invite_account_created',
      entityType: team_id ? 'partner_team' : 'company',
      entityId: team_id ?? company_id,
      ip,
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { invite_id, created_new: createdNew },
    });

    return jsonResponse(
      {
        ok: true,
        created_new: createdNew,
        role,
        team_id,
        company_id,
        // The client signs in normally after this. On the driver's first
        // landing screen, InviteAcceptHost will pop the Accept/Decline
        // popup against this invite (which is still status='sent').
        message: createdNew
          ? "Account ready — sign in and you'll get an invite popup."
          : "Account already exists — sign in and you'll get an invite popup.",
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
