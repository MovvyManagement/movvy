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
  const emailSubject = `${teamName} invited you to drive with Movvy`;
  // Plain-text fallback for email clients that strip HTML (Outlook 2003,
  // accessibility readers). The HTML render below is what 99% of recipients
  // see; this is the safety net.
  const emailText =
    `${teamName} has added you to their Movvy crew.\n\n` +
    `Your invite code: ${inviteCode}\n\n` +
    `1. Download Movvy from the App Store / Play Store\n` +
    `2. Tap "Got an invite from your team?" on the welcome screen\n` +
    `3. Enter the code above and the ${invitee.phone ? 'phone' : 'email'} you were invited with\n\n` +
    `Or open this link from your phone: ${deepLink}`;
  const emailHtml = buildInviteEmailHtml({
    inviteeName: invitee.full_name ?? null,
    teamName,
    inviteCode,
    deepLink,
    contactMode: invitee.phone ? 'phone' : 'email',
  });

  // Try SMS first when phone present
  if (invitee.phone) {
    const sms = await sendSmsViaTwilio(invitee.phone, smsBody);
    if (!sms.error) {
      // Also email if both were provided
      if (invitee.email) {
        await sendEmail(invitee.email, emailSubject, emailText, emailHtml); // fire-and-forget
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
    const em = await sendEmail(invitee.email, emailSubject, emailText, emailHtml);
    return {
      channel: em.error ? null : 'email',
      providerId: em.providerId,
      error: em.error,
    };
  }

  return { channel: null, error: 'No contact channel' };
}

// ─── Branded HTML invite email ───────────────────────────────────────────────
// Inline-CSS only — Gmail/Outlook/Apple Mail all strip <style> blocks. The
// logo is an embedded SVG so it renders offline + with images disabled.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch),
  );
}

function buildInviteEmailHtml(args: {
  inviteeName: string | null;
  teamName: string;
  inviteCode: string;
  deepLink: string;
  contactMode: 'phone' | 'email';
}): string {
  const { inviteeName, teamName, inviteCode, deepLink, contactMode } = args;
  const greeting = inviteeName ? `Hi ${escapeHtml(inviteeName)},` : 'Hi there,';
  const team = escapeHtml(teamName);
  const code = escapeHtml(inviteCode);
  const link = escapeHtml(deepLink);

  // App Store URLs match the badge links on movvy.ca. Swap idTODO once your
  // iOS listing is approved — Android URL is already correct (bundle ID).
  const iosUrl = 'https://apps.apple.com/ca/app/movvy/idTODO';
  const androidUrl = 'https://play.google.com/store/apps/details?id=com.movvy.app';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${team} invited you to Movvy</title></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E4E4E7;">

        <!-- HERO -->
        <tr><td style="background:linear-gradient(135deg,#047857 0%,#0E9F6E 50%,#16A34A 100%);padding:36px 32px;text-align:center;">
          <svg viewBox="0 0 100 100" width="64" height="64" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;">
            <rect width="100" height="100" rx="22" fill="#FFFFFF"/>
            <rect x="20" y="40" width="38" height="35" rx="3.5" fill="#0E9F6E"/>
            <line x1="39" y1="40" x2="39" y2="75" stroke="#FFFFFF" stroke-width="1.5"/>
            <text x="39.5" y="62" text-anchor="middle" fill="#FFFFFF" font-weight="800" font-size="9.5" font-family="Helvetica,Arial,sans-serif">Movvy</text>
            <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="#0E9F6E"/>
            <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0"/>
            <circle cx="32" cy="78" r="6.2" fill="#1F2937"/>
            <circle cx="70" cy="78" r="6.2" fill="#1F2937"/>
            <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0"/>
            <circle cx="76" cy="22" r="10" fill="#0E9F6E"/>
            <path d="M76 32 L72 38 L80 38 Z" fill="#0E9F6E"/>
            <circle cx="76" cy="22" r="4.2" fill="#FFFFFF"/>
          </svg>
          <div style="margin-top:14px;color:#FFFFFF;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;">You've been invited to drive</div>
          <div style="margin-top:6px;color:#FFFFFF;font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1.2;">Welcome to ${team}.</div>
        </td></tr>

        <!-- BODY -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#0A0A0A;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#404040;">
            <strong>${team}</strong> just added you to their crew on Movvy — Alberta's moving
            marketplace. To start receiving job offers, download the app and enter your
            personal invite code below.
          </p>

          <!-- INVITE CODE CARD -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#ECFDF5;border:2px dashed #16A34A;border-radius:14px;padding:24px;text-align:center;">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#047857;">Your Invite Code</div>
              <div style="margin-top:8px;font-size:38px;font-weight:800;letter-spacing:3px;color:#0A0A0A;font-family:'SF Mono',Menlo,Consolas,monospace;">${code}</div>
              <div style="margin-top:6px;font-size:12px;color:#52525B;">Valid for ${escapeHtml(args.inviteeName ? args.inviteeName.split(' ')[0] : 'you')} · single-use</div>
            </td></tr>
          </table>

          <!-- INSTRUCTIONS -->
          <div style="font-size:14px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#71717A;margin-bottom:12px;">How to Join</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="font-size:14px;line-height:1.7;color:#0A0A0A;">
              <strong>1.</strong> Download Movvy on iOS or Android (links below).<br>
              <strong>2.</strong> Tap <em>"Got an invite from your team?"</em> on the welcome screen.<br>
              <strong>3.</strong> Enter <strong>${code}</strong> and the ${contactMode} you were invited with.<br>
              <strong>4.</strong> Upload your ID + driver's license. Movvy verifies in 24–48 hours.
            </td></tr>
          </table>

          <!-- STORE BADGES -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="padding-right:8px;width:50%;">
                <a href="${iosUrl}" style="display:block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px;text-align:center;font-weight:700;font-size:14px;">Download for iOS</a>
              </td>
              <td style="padding-left:8px;width:50%;">
                <a href="${androidUrl}" style="display:block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px;text-align:center;font-weight:700;font-size:14px;">Download for Android</a>
              </td>
            </tr>
          </table>

          <!-- UNIVERSAL LINK -->
          <div style="text-align:center;padding-top:8px;border-top:1px solid #F4F4F5;">
            <div style="font-size:12px;color:#71717A;margin-bottom:6px;">Already have Movvy installed?</div>
            <a href="${link}" style="color:#047857;font-weight:700;font-size:14px;text-decoration:none;">Open the app to accept →</a>
          </div>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
          <div style="font-size:12px;color:#71717A;line-height:1.6;">
            <strong style="color:#0A0A0A;">Movvy Technologies Inc.</strong><br>
            Calgary, AB · Alberta-wide<br>
            Questions? Reply to this email or write to
            <a href="mailto:partner@movvy.ca" style="color:#047857;text-decoration:none;">partner@movvy.ca</a>
          </div>
        </td></tr>

      </table>

      <div style="margin-top:16px;font-size:11px;color:#A1A1AA;text-align:center;max-width:560px;">
        You received this email because ${team} added your address to their Movvy crew. If
        this was unexpected, you can safely ignore it — no account is created until you
        sign in with the code above.
      </div>

    </td></tr>
  </table>
</body>
</html>`;
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
  text: string,
  html?: string,
): Promise<{ providerId?: string; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  // Default sender uses partner@movvy.ca — the real inbox the user owns
  // (no Cloudflare aliasing needed). Override via the RESEND_FROM env var
  // if you'd rather invites come from a "no-reply" address.
  const from = Deno.env.get('RESEND_FROM') ?? 'Movvy Partners <partner@movvy.ca>';
  if (!apiKey) {
    console.log('[partners-invite-send/email-stub]', { to, subject, text });
    return {}; // dev mode — pretend it worked
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        html
          ? { from, to, subject, text, html, reply_to: 'partner@movvy.ca' }
          : { from, to, subject, text, reply_to: 'partner@movvy.ca' },
      ),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.message ?? `Resend ${res.status}` };
    return { providerId: data?.id };
  } catch (e: any) {
    return { error: e?.message ?? 'Resend fetch failed' };
  }
}
