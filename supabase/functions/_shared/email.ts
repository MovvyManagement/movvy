// =============================================================================
// Branded email helper — one source of truth for the Movvy email layout
// (green-gradient hero, embedded SVG logo, Outlook-safe inline CSS, footer
// with legal address) and a single sendBrandedEmail() helper that wraps
// the Resend API call.
//
// Every transactional email in the codebase should:
//   1. Build subject + body parts using the helpers below
//   2. Call sendBrandedEmail() — not fetch('https://api.resend.com/...')
//      directly
//
// Keeping this centralized means we can:
//   • Change the brand color in one place
//   • Swap providers (Resend → Postmark → SES) without touching templates
//   • Tag every send with a "template" name for analytics in email_events
// =============================================================================

const RESEND_API = 'https://api.resend.com/emails';

// ─── Brand-aware sender selection ────────────────────────────────────────────
// We send from 3 inboxes depending on the email's audience. Each is a real
// inbox on movvy.ca (no Cloudflare aliasing) so the recipient can hit reply
// and reach a human.
const SENDER_BY_KIND = {
  customer: 'Movvy <hello@movvy.ca>',
  partner: 'Movvy Partners <partner@movvy.ca>',
  support: 'Movvy Support <support@movvy.ca>',
} as const;

export type EmailKind = keyof typeof SENDER_BY_KIND;

// ─── HTML escape ─────────────────────────────────────────────────────────────
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch),
  );
}

// ─── Embedded Movvy SVG logo ─────────────────────────────────────────────────
// Inline SVG renders without external image requests — works with image-
// blocking, offline, and Outlook. Color baked in so it's brand-correct
// even when the surrounding header is white.
function logoSvg(fill: '#FFFFFF' | '#0E9F6E' = '#FFFFFF'): string {
  return `<svg viewBox="0 0 100 100" width="64" height="64" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;">
    <rect width="100" height="100" rx="22" fill="${fill === '#FFFFFF' ? '#FFFFFF' : '#0E9F6E'}"/>
    <rect x="20" y="40" width="38" height="35" rx="3.5" fill="${fill === '#FFFFFF' ? '#0E9F6E' : '#FFFFFF'}"/>
    <line x1="39" y1="40" x2="39" y2="75" stroke="${fill === '#FFFFFF' ? '#FFFFFF' : '#D1FAE5'}" stroke-width="1.5"/>
    <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="${fill === '#FFFFFF' ? '#0E9F6E' : '#FFFFFF'}"/>
    <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0"/>
    <circle cx="32" cy="78" r="6.2" fill="#1F2937"/>
    <circle cx="70" cy="78" r="6.2" fill="#1F2937"/>
    <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0"/>
    <circle cx="76" cy="22" r="10" fill="${fill === '#FFFFFF' ? '#0E9F6E' : '#FFFFFF'}"/>
    <path d="M76 32 L72 38 L80 38 Z" fill="${fill === '#FFFFFF' ? '#0E9F6E' : '#FFFFFF'}"/>
    <circle cx="76" cy="22" r="4.2" fill="${fill === '#FFFFFF' ? '#FFFFFF' : '#0E9F6E'}"/>
  </svg>`;
}

// ─── Layout wrapper ──────────────────────────────────────────────────────────

export interface BrandedEmailParts {
  /** Inner page <title>, also used as the OG / preview text. */
  title: string;
  /** Big white text rendered on top of the green hero. */
  heroHeadline: string;
  /** Small all-caps eyebrow above the headline (e.g. "WELCOME"). */
  heroEyebrow?: string;
  /** Inline HTML for the body. Use the helper functions below. */
  bodyHtml: string;
  /** Reply-to override. Defaults to the same as the From address. */
  replyTo?: string;
  /** Which "from" inbox to use. */
  kind: EmailKind;
}

export function buildBrandedEmailHtml(parts: BrandedEmailParts): string {
  const { title, heroEyebrow, heroHeadline, bodyHtml } = parts;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E4E4E7;">

        <!-- HERO -->
        <tr><td style="background:linear-gradient(135deg,#047857 0%,#0E9F6E 50%,#16A34A 100%);padding:36px 32px;text-align:center;">
          ${logoSvg('#FFFFFF')}
          ${
            heroEyebrow
              ? `<div style="margin-top:14px;color:#FFFFFF;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;">${escapeHtml(
                  heroEyebrow,
                )}</div>`
              : ''
          }
          <div style="margin-top:${
            heroEyebrow ? '6' : '14'
          }px;color:#FFFFFF;font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1.2;">${escapeHtml(
            heroHeadline,
          )}</div>
        </td></tr>

        <!-- BODY -->
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;color:#0A0A0A;">
          ${bodyHtml}
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
          <div style="font-size:12px;color:#71717A;line-height:1.6;">
            <strong style="color:#0A0A0A;">Movvy Technologies Inc.</strong><br>
            Calgary, AB · Alberta-wide<br>
            Questions? Write to
            <a href="mailto:support@movvy.ca" style="color:#047857;text-decoration:none;">support@movvy.ca</a>
            · <a href="https://movvy.ca" style="color:#047857;text-decoration:none;">movvy.ca</a>
          </div>
        </td></tr>

      </table>

      <div style="margin-top:16px;font-size:11px;color:#A1A1AA;text-align:center;max-width:560px;">
        You're receiving this email because you have a Movvy account or were
        added to a Movvy crew. To manage email preferences, open the Movvy
        app and head to Settings → Notifications.
      </div>

    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Body-content helpers (call from template builders) ──────────────────────

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#404040;">${html}</p>`;
}

/** Big standalone CTA button. Centered. */
export function buttonCta(label: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td align="center">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#047857;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px 28px;font-weight:700;font-size:15px;">${escapeHtml(
    label,
  )}</a>
    </td></tr>
  </table>`;
}

/** A dashed-border "code" card (mirrors the partner invite). Use for one-time
 *  codes, invite codes, or confirmation numbers. */
export function codeCard(label: string, code: string, sub?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#ECFDF5;border:2px dashed #16A34A;border-radius:14px;padding:24px;text-align:center;">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#047857;">${escapeHtml(
        label,
      )}</div>
      <div style="margin-top:8px;font-size:38px;font-weight:800;letter-spacing:3px;color:#0A0A0A;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(
        code,
      )}</div>
      ${
        sub
          ? `<div style="margin-top:6px;font-size:12px;color:#52525B;">${escapeHtml(sub)}</div>`
          : ''
      }
    </td></tr>
  </table>`;
}

/** A row of "details" — useful for booking summaries, receipts. */
export interface DetailRow {
  label: string;
  value: string;
}
export function detailTable(rows: DetailRow[]): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #F4F4F5;font-size:13px;color:#71717A;width:40%;">${escapeHtml(
          r.label,
        )}</td>
        <td style="padding:10px 0;border-bottom:1px solid #F4F4F5;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;">${escapeHtml(
          r.value,
        )}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:1px solid #F4F4F5;">${body}</table>`;
}

/** "01. Step title — description" style ordered list. */
export interface Step {
  title: string;
  body: string;
}
export function stepList(steps: Step[]): string {
  return steps
    .map(
      (s, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
          <td valign="top" style="width:32px;font-size:14px;font-weight:800;color:#047857;padding-top:2px;">${String(
            i + 1,
          ).padStart(2, '0')}</td>
          <td style="font-size:14px;line-height:1.5;color:#0A0A0A;">
            <strong>${escapeHtml(s.title)}</strong><br>
            <span style="color:#52525B;">${escapeHtml(s.body)}</span>
          </td>
        </tr>
      </table>`,
    )
    .join('');
}

/** Inline App Store + Play Store buttons. */
export function storeBadges(): string {
  const iosUrl = 'https://apps.apple.com/ca/app/movvy/idTODO';
  const androidUrl = 'https://play.google.com/store/apps/details?id=com.movvy.app';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="padding-right:8px;width:50%;">
        <a href="${iosUrl}" style="display:block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px;text-align:center;font-weight:700;font-size:14px;">Download for iOS</a>
      </td>
      <td style="padding-left:8px;width:50%;">
        <a href="${androidUrl}" style="display:block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px;text-align:center;font-weight:700;font-size:14px;">Download for Android</a>
      </td>
    </tr>
  </table>`;
}

// ─── Plain-text fallback builder ─────────────────────────────────────────────
//
// Strips HTML, collapses whitespace. Used for the `text` field on every
// Resend send so Outlook 2003 / accessibility readers / spam filters
// always have a clean version.
export function stripToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Top-level template type all builders produce ─────────────────────────────

export interface BrandedTemplate {
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  /** Used to tag email_events for per-template analytics + bounce attribution. */
  templateKey: string;
}

// ─── Send helper ─────────────────────────────────────────────────────────────
//
// Single entry point all functions should use. Handles:
//   • Sender selection by kind
//   • Reply-to defaulting to the same inbox
//   • Tagging with templateKey (Resend forwards via webhook → email_events)
//   • Stub mode when RESEND_API_KEY missing (logs to console)

export interface SendEmailResult {
  providerId?: string;
  error?: string;
}

export async function sendBrandedEmail(args: {
  to: string | string[];
  template: BrandedTemplate;
  /** Override the From address — defaults to the inbox matching template.kind. */
  fromOverride?: string;
}): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from =
    args.fromOverride ??
    Deno.env.get(`RESEND_FROM_${args.template.kind.toUpperCase()}`) ??
    SENDER_BY_KIND[args.template.kind];
  const replyTo = from.match(/<([^>]+)>/)?.[1] ?? from;

  // Stub mode — no API key, no real send. Logs the headline so you can see
  // the message went out in dev.
  if (!apiKey) {
    console.log('[email-stub]', {
      to: args.to,
      from,
      subject: args.template.subject,
      templateKey: args.template.templateKey,
    });
    return {};
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.template.subject,
        html: args.template.html,
        text: args.template.text,
        reply_to: replyTo,
        tags: [
          { name: 'template', value: args.template.templateKey },
          { name: 'kind', value: args.template.kind },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: data?.message ?? `Resend ${res.status}` };
    }
    return { providerId: data?.id };
  } catch (e: any) {
    return { error: e?.message ?? 'Resend fetch failed' };
  }
}
