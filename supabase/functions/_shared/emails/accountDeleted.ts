// =============================================================================
// Account deleted — confirmation sent after a user deletes their Movvy
// account. Required by PIPEDA + Apple/Google app store policies for any
// app that lets users sign up.
//
// This used to promise a 30-day restore window followed by a permanent purge.
// Neither was true. account-delete strips personal details IMMEDIATELY (step 2
// of that function) — so there is nothing left to restore the next day, let
// alone in thirty — and no job has ever existed to do the purge; the auth row
// is banned for a century rather than deleted, deliberately, because
// ON DELETE CASCADE would take every booking and payout record with it.
//
// The design is right and PIPEDA-defensible: personal information is erased on
// request, and the financial records CRA requires for six years are kept in a
// form that is no longer linked to a person. The email now says that, because
// telling someone their data will be purged on a date when it will not is
// exactly the kind of promise a privacy regulator reads closely.
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
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your Movvy account has been deleted`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Your Movvy account has been deleted as requested. <strong>This has already happened</strong> — your name, phone number, saved addresses and notification settings have been erased, your sign-in no longer works, and nothing of yours is visible in the app.`,
    ),
    paragraph(
      `We are required to keep records of completed moves and payments for six years under Canada Revenue Agency rules. Those records remain, but they are no longer connected to you: your name and contact details have been removed from them.`,
    ),
    paragraph(
      `Your email address and phone number have been released, so if you ever want to come back you can sign up again with the same details. It will be a fresh account — your old bookings will not return.`,
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
