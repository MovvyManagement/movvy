// =============================================================================
// Document needs resubmission — when the admin flags a specific doc
// (license expired, photo blurry, wrong format) so the partner doesn't
// get fully approved but isn't outright rejected.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  buttonCta,
  escapeHtml,
  paragraph,
  stripToText,
} from '../email.ts';

export function docNeedsResubmission(args: {
  fullName?: string | null;
  /** e.g. "Driver's License", "Vehicle Registration", "Proof of Insurance" */
  docName: string;
  /** Human reason set by the admin. */
  reason: string;
  /** Deep link into the upload screen for this specific doc. */
  uploadUrl: string;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Movvy: We need a new copy of your ${args.docName.toLowerCase()}`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Your application is almost there. We need a fresh copy of your <strong>${escapeHtml(
        args.docName,
      )}</strong> before we can finish the review.`,
    ),
    paragraph(
      `<strong>What we found:</strong> ${escapeHtml(args.reason)}`,
    ),
    paragraph(
      `Open the app, head to the document upload screen, and replace the file. The link below jumps you straight there:`,
    ),
    buttonCta(`Upload ${args.docName}`, args.uploadUrl),
    paragraph(
      `<strong>Tip:</strong> good doc photos are well-lit, all four corners visible, no fingers in the frame, and ideally taken on a dark surface to avoid glare.`,
    ),
    paragraph(
      `Once you upload, we'll review within 24 hours and finish onboarding. Questions? Reply to this email.`,
    ),
    paragraph(`<em>— Movvy Partner Onboarding</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Action Needed',
    heroHeadline: `One more thing on your ${args.docName.toLowerCase()}.`,
    bodyHtml,
    kind: 'partner',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'partner',
    templateKey: 'docNeedsResubmission',
  };
}
