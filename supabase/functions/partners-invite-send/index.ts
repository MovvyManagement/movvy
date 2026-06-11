// =============================================================================
// POST /partners-invite-send
//
// Owners (team driver, company owner/dispatcher) call this to invite crew
// members. We:
//   1. Confirm the caller belongs to the team/company they're inviting into
//   2. Insert a partner_invites row per contact (or update an existing pending
//      one — re-inviting the same email/phone is a no-op + resend)
//   3. Dispatch SMS (preferred when phone provided) or email with the invite
//      code + a deep link. Twilio + Resend stubbed when secrets missing.
//
// Returns the list of invites with their status so the UI can show pending /
// sent / failed per row.
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

const Email = z.string().trim().toLowerCase().email();
const PhoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required');
const InviteEntry = z
  .object({
    full_name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(['driver', 'mover', 'dispatcher']),
    email: Email.optional(),
    phone: PhoneE164.optional(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: 'Each invitee needs an email or phone number',
  });

const Body = z
  .object({
    team_id: z.string().uuid().optional(),
    company_id: z.string().uuid().optional(),
    invites: z.array(InviteEntry).min(1).max(50),
  })
  .refine((v) => !!v.team_id !== !!v.company_id, {
    message: 'Provide exactly one of team_id or company_id',
  });

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:partners_invite_send`,
      endpoint: 'partners-invite-send',
      limit: 30,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { team_id, company_id, invites } = parsed.data;

    const admin = adminClient();

    // ─── Authorise: caller must own / belong to the recipient ────────────────
    let inviteCode: string | null = null;
    let displayName = '';
    if (team_id) {
      const { data: team, error: tErr } = await admin
        .from('partner_teams')
        .select('id, invite_code, display_name')
        .eq('id', team_id)
        .maybeSingle();
      if (tErr || !team) throw httpError(404, 'Team not found');

      const { data: membership } = await admin
        .from('partner_team_members')
        .select('id')
        .eq('team_id', team_id)
        .eq('profile_id', user.id)
        .is('removed_at', null)
        .maybeSingle();
      if (!membership) throw httpError(403, 'You are not a member of this team');

      inviteCode = team.invite_code;
      displayName = team.display_name ?? 'your Movvy team';
    } else if (company_id) {
      const { data: company, error: cErr } = await admin
        .from('companies')
        .select('id, invite_code, display_name')
        .eq('id', company_id)
        .maybeSingle();
      if (cErr || !company) throw httpError(404, 'Company not found');

      const { data: membership } = await admin
        .from('company_members')
        .select('id, role')
        .eq('company_id', company_id)
        .eq('profile_id', user.id)
        .is('removed_at', null)
        .maybeSingle();
      if (!membership) throw httpError(403, 'You are not a member of this company');
      if (!['owner', 'dispatcher'].includes(membership.role)) {
        throw httpError(403, 'Only owners or dispatchers can invite');
      }

      inviteCode = company.invite_code;
      displayName = company.display_name;
    }

    // ─── Insert / upsert invite rows ──────────────────────────────────────────
    const results: Array<{
      email?: string;
      phone?: string;
      role: string;
      status: 'sent' | 'failed';
      channel: 'sms' | 'email' | 'both' | null;
      error?: string;
    }> = [];

    for (const inv of invites) {
      // Check for an existing pending invite for the same contact in this team
      const matchQuery = admin.from('partner_invites').select('id, status');
      if (team_id) matchQuery.eq('team_id', team_id);
      if (company_id) matchQuery.eq('company_id', company_id);
      if (inv.email) matchQuery.eq('email', inv.email);
      if (inv.phone) matchQuery.eq('phone', inv.phone);
      const { data: existing } = await matchQuery
        .in('status', ['pending', 'sent'])
        .maybeSingle();

      let invite_id: string;
      if (existing?.id) {
        invite_id = existing.id;
      } else {
        const { data: inserted, error: iErr } = await admin
          .from('partner_invites')
          .insert({
            team_id: team_id ?? null,
            company_id: company_id ?? null,
            role: inv.role,
            full_name: inv.full_name ?? null,
            email: inv.email ?? null,
            phone: inv.phone ?? null,
            invited_by_profile_id: user.id,
          })
          .select('id')
          .single();
        if (iErr || !inserted) {
          results.push({
            email: inv.email,
            phone: inv.phone,
            role: inv.role,
            status: 'failed',
            channel: null,
            error: iErr?.message ?? 'Insert failed',
          });
          continue;
        }
        invite_id = inserted.id;
      }

      // ─── Send notification — SMS preferred, fall back to email ──────────────
      const send = await dispatchInvite({
        invitee: inv,
        inviteCode: inviteCode!,
        teamName: displayName,
        invitedByEmail: user.email ?? undefined,
      });

      await admin
        .from('partner_invites')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_channel: send.channel,
          last_provider_msg_id: send.providerId ?? null,
          last_send_error: send.error ?? null,
        })
        .eq('id', invite_id);

      results.push({
        email: inv.email,
        phone: inv.phone,
        role: inv.role,
        status: send.error ? 'failed' : 'sent',
        channel: send.channel,
        error: send.error,
      });
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'partners.invite_send',
      entityType: team_id ? 'partner_team' : 'company',
      entityId: team_id ?? company_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { invites: invites.length, results },
    });

    return jsonResponse(
      { ok: true, invite_code: inviteCode, results },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.message }, { status: e.status }, cors);
    }
    console.error('[partners-invite-send] unexpected', e);
    return jsonResponse({ error: 'Internal error' }, { status: 500 }, cors);
  }
});

// ─── notification dispatch ───────────────────────────────────────────────────
//
// Tries Twilio first when a phone is on file; otherwise (or on failure) tries
// the configured email provider. When neither is configured (dev / preview
// environments) we log to console and return ok — the invite is still recorded.

async function dispatchInvite(args: {
  invitee: { email?: string; phone?: string; full_name?: string };
  inviteCode: string;
  teamName: string;
  invitedByEmail?: string;
}): Promise<{ channel: 'sms' | 'email' | 'both' | null; providerId?: string; error?: string }> {
  const { invitee, inviteCode, teamName } = args;
  const deepLink = `${Deno.env.get('PUBLIC_APP_URL') ?? 'https://movvy.ca'}/join/${inviteCode}`;
  const smsBody = `Movvy: ${teamName} added you to their crew. Code: ${inviteCode}. Join: ${deepLink}`;
  const emailSubject = `${teamName} invited you to Movvy`;
  const emailBody =
    `${teamName} has added you to their Movvy crew.\n\n` +
    `Your team invite code: ${inviteCode}\n\n` +
    `1. Download Movvy from the App Store / Play Store\n` +
    `2. Tap "Got an invite from your team?" on the welcome screen\n` +
    `3. Enter the code above and the ${invitee.phone ? 'phone' : 'email'} you were invited with\n\n` +
    `Or open this link from your phone: ${deepLink}`;

  // Try SMS first when phone present
  if (invitee.phone) {
    const sms = await sendSmsViaTwilio(invitee.phone, smsBody);
    if (!sms.error) {
      // Also email if both were provided
      if (invitee.email) {
        await sendEmail(invitee.email, emailSubject, emailBody); // fire-and-forget
        return { channel: 'both', providerId: sms.providerId };
      }
      return { channel: 'sms', providerId: sms.providerId };
    }
    // SMS failed — fall through to email if available
    if (!invitee.email) {
      return { channel: null, error: sms.error };
    }
  }

  if (invitee.email) {
    const em = await sendEmail(invitee.email, emailSubject, emailBody);
    return {
      channel: em.error ? null : 'email',
      providerId: em.providerId,
      error: em.error,
    };
  }

  return { channel: null, error: 'No contact channel' };
}

async function sendSmsViaTwilio(
  to: string,
  body: string,
): Promise<{ providerId?: string; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER');
  if (!sid || !token || !from) {
    console.log('[partners-invite-send/sms-stub]', { to, body });
    return {}; // dev mode — pretend it worked
  }
  try {
    const auth = btoa(`${sid}:${token}`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.message ?? `Twilio ${res.status}` };
    return { providerId: data?.sid };
  } catch (e: any) {
    return { error: e?.message ?? 'Twilio fetch failed' };
  }
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ providerId?: string; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM') ?? 'crew@movvy.ca';
  if (!apiKey) {
    console.log('[partners-invite-send/email-stub]', { to, subject, body });
    return {}; // dev mode — pretend it worked
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.message ?? `Resend ${res.status}` };
    return { providerId: data?.id };
  } catch (e: any) {
    return { error: e?.message ?? 'Resend fetch failed' };
  }
}
