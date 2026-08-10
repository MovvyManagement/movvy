// =============================================================================
// Password reset code — the 6-digit code for Movvy's own reset flow.
//
// Movvy mints and sends these itself rather than using Supabase's OTP endpoint,
// which is a public account-enumeration oracle (see migration 0107 and the
// password-reset-request function). So this template is the email side of that
// flow.
//
// Deliberately plain: a code, how long it lasts, and what to do if it wasn't
// you. No marketing, no other links — a reset email is the single most phished
// message a product sends, and every extra clickable thing in it teaches the
// recipient a habit we don't want them to have.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  escapeHtml,
  paragraph,
  stripToText,
} from '../email.ts';

export function passwordResetCode(args: {
  fullName?: string | null;
  /** The plaintext 6-digit code. Never logged, never stored — only hashed. */
  code: string;
  expiresInMinutes: number;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your Movvy password reset code: ${args.code}`;

  const codeBlock = `
    <div style="margin:24px 0;padding:20px;background:#F4F4F5;border-radius:14px;text-align:center">
      <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#71717A">
        Your reset code
      </div>
      <div style="margin-top:8px;font-size:36px;font-weight:800;letter-spacing:8px;color:#0A0A0A;font-variant-numeric:tabular-nums">
        ${escapeHtml(args.code)}
      </div>
      <div style="margin-top:6px;font-size:12px;color:#71717A">
        Expires in ${args.expiresInMinutes} minutes
      </div>
    </div>`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(`Enter this code in the Movvy app to set a new password.`),
    codeBlock,
    paragraph(
      `<strong>If you didn't ask to reset your password, you can ignore this email</strong> — ` +
      `your password hasn't changed and nobody can use this code without it.`,
    ),
    paragraph(
      `Movvy will never ask you for this code by phone, text or email. If someone does, it isn't us.`,
    ),
    paragraph(`<em>— The Movvy team</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Password Reset',
    heroHeadline: 'Here’s your code.',
    bodyHtml,
    kind: 'support',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'support',
    templateKey: 'passwordResetCode',
  };
}
