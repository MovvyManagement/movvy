// =============================================================================
// Account deleted — confirmation sent after a user deletes their Movvy
// account. Required by PIPEDA + Apple/Google app store policies for any
// app that lets users sign up.
//
// Includes the 30-day "we can still restore" window per Canadian retention
// rules. Past 30 days, we hard-delete (account-delete edge function
// handles the actual purge cron-style).
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  escapeHtml,
  paragraph,
  stripToText,
} from '../email.ts';

export function accountDeleted(args: {
  fullName?: string | null;
  /** When the soft-delete window expires (ISO date). */
  hardDeleteOn: string;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your Movvy account has been deleted`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Your Movvy account has been deleted as requested. Your bookings, profile, and any saved addresses are now hidden from the app.`,
    ),
    paragraph(
      `<strong>Within 30 days</strong> (until <strong>${escapeHtml(
        args.hardDeleteOn,
      )}</strong>) we can still restore your account if you change your mind — just reply to this email.`,
    ),
    paragraph(
      `After that date, everything is permanently purged from our systems, including payment records (anonymized for tax compliance per Canada Revenue Agency requirements).`,
    ),
    paragraph(
      `Thank you for trying Movvy. If there's anything we could have done better, we'd genuinely love to hear it — just hit reply.`,
    ),
    paragraph(`<em>— The Movvy team</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Account Closed',
    heroHeadline: `Sorry to see you go${name !== 'there' ? `, ${name}` : ''}.`,
    bodyHtml,
    kind: 'support',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'support',
    templateKey: 'accountDeleted',
  };
}
