// =============================================================================
// Mover application declined — sent when the admin rejects an application.
// Includes a human-readable reason + reapply window so we don't end up in
// arbitrary-gatekeeper territory.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  escapeHtml,
  paragraph,
  stripToText,
} from '../email.ts';

export function moverApplicationDeclined(args: {
  fullName?: string | null;
  reason: string;             // human-readable, set by the admin
  reapplyAfter?: string | null; // "in 6 months" or "January 1, 2027"
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Movvy: An update on your application`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Thanks again for applying to drive with Movvy. After reviewing your application, we won't be able to bring you onto the platform at this time.`,
    ),
    paragraph(
      `<strong>Reason:</strong> ${escapeHtml(args.reason)}`,
    ),
    args.reapplyAfter
      ? paragraph(
          `You're welcome to reapply <strong>${escapeHtml(
            args.reapplyAfter,
          )}</strong>. We keep no negative record of declined applications — a fresh submission gets a fresh review.`,
        )
      : paragraph(
          `If you believe this was a mistake or your circumstances have changed, write to <a href="mailto:partner@movvy.ca" style="color:#047857;">partner@movvy.ca</a> with any clarifying details and we'll take another look.`,
        ),
    paragraph(
      `We know this isn't the email you were hoping for. Thank you for the time you put into the application.`,
    ),
    paragraph(`<em>— Movvy Partner Onboarding</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Application Update',
    heroHeadline: 'An update on your application.',
    bodyHtml,
    kind: 'partner',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'partner',
    templateKey: 'moverApplicationDeclined',
  };
}
