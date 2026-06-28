// =============================================================================
// Move complete — sent when the driver marks the move "completed".
// The PDF receipt lives in the app under Receipts; this email summarizes
// the actual charge + nudges the customer to rate their crew.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  buttonCta,
  detailTable,
  escapeHtml,
  paragraph,
  stripToText,
} from '../email.ts';

export function moveComplete(args: {
  fullName?: string | null;
  shortCode: string;
  crewLeadName?: string | null;
  actualHours: string;       // "3.5 hrs"
  actualTotalDollars: string; // "$1,612"
  receiptUrl: string;        // deep link to in-app receipt
  rateUrl: string;           // deep link to rating screen
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Move complete · ${args.actualTotalDollars} · #${args.shortCode}`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      args.crewLeadName
        ? `Your move is wrapped. <strong>${escapeHtml(
            args.crewLeadName,
          )}</strong> and the crew are clocked out — boxes off the truck.`
        : `Your move is wrapped. The crew is clocked out — boxes off the truck.`,
    ),
    detailTable([
      { label: 'Booking #', value: args.shortCode },
      { label: 'Hours worked', value: args.actualHours },
      { label: 'Total billed', value: args.actualTotalDollars },
    ]),
    paragraph(
      `Your full itemized receipt (with hourly breakdown, materials, fuel, and tax) lives in the app under <strong>Receipts</strong>.`,
    ),
    buttonCta('View Receipt', args.receiptUrl),
    paragraph(
      `One tiny ask: <a href="${escapeHtml(
        args.rateUrl,
      )}" style="color:#047857;font-weight:600;">rate your crew</a> so other Albertans know who to book. Takes 5 seconds.`,
    ),
    paragraph(`Thanks for moving with us. — The Movvy team`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Move Complete',
    heroHeadline: 'Stress unpacked. Life resumed.',
    bodyHtml,
    kind: 'customer',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'customer',
    templateKey: 'moveComplete',
  };
}
