// =============================================================================
// Mover application received — sent the moment a partner finishes the
// onboarding flow + uploads their docs. Sets expectations so they don't
// email support asking "did you get my application?" 12 hours in.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  escapeHtml,
  paragraph,
  stepList,
  stripToText,
} from '../email.ts';

export function moverApplicationReceived(args: {
  fullName?: string | null;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Movvy: We've got your application 🚚`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Thanks for applying to drive with Movvy. Your application + documents are in front of our verification team.`,
    ),
    paragraph(`<strong>What happens next:</strong>`),
    stepList([
      {
        title: 'Document review',
        body: 'We check your ID, driver\'s license, vehicle docs, and insurance — usually within 24–48 hours.',
      },
      {
        title: 'Background check',
        body: 'A standard Canadian criminal record check (via Certn). Most clear within a day.',
      },
      {
        title: 'You\'re live',
        body: 'Once you\'re approved, job offers start showing up the same hour. Accept what fits your schedule.',
      },
    ]),
    paragraph(
      `If we need anything else, you'll get a follow-up email with exactly what to upload. No need to chase us.`,
    ),
    paragraph(`Questions? Reply to this email — we read every one.`),
    paragraph(`<em>— Movvy Partner Onboarding</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Application Received',
    heroHeadline: 'Welcome to the next step.',
    bodyHtml,
    kind: 'partner',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'partner',
    templateKey: 'moverApplicationReceived',
  };
}
