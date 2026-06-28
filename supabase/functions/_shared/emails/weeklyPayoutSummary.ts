// =============================================================================
// Weekly payout summary — sent every Friday morning to every active mover
// and company. Shows last week's earnings + when the deposit lands.
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

export function weeklyPayoutSummary(args: {
  fullName?: string | null;
  /** e.g. "Jun 17–23" */
  weekRange: string;
  jobsCompleted: number;
  hoursWorked: string;            // "23.5 hrs"
  grossDollars: string;           // "$2,940"
  movvyFeeDollars: string;        // "$588"  (20% of gross)
  tipsDollars: string;            // "$120"
  netDollars: string;             // "$2,472"
  depositLandsOn: string;         // "Mon, Jun 24"
  earningsUrl: string;            // deep link to in-app earnings tab
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your Movvy payout · ${args.weekRange} · ${args.netDollars}`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Here's your week. <strong>${escapeHtml(
        args.netDollars,
      )}</strong> hits your bank on <strong>${escapeHtml(args.depositLandsOn)}</strong>.`,
    ),
    detailTable([
      { label: 'Week', value: args.weekRange },
      { label: 'Jobs completed', value: String(args.jobsCompleted) },
      { label: 'Hours worked', value: args.hoursWorked },
      { label: 'Gross earnings', value: args.grossDollars },
      { label: 'Movvy fee (20%)', value: `−${args.movvyFeeDollars}` },
      { label: 'Customer tips', value: args.tipsDollars },
      { label: 'Net payout', value: args.netDollars },
    ]),
    buttonCta('See Full Breakdown', args.earningsUrl),
    paragraph(
      `Per-job breakdowns (which customer, which day, materials, fuel, tip) live in the app under <strong>Earnings → ${escapeHtml(
        args.weekRange,
      )}</strong>.`,
    ),
    paragraph(
      `Heads up: a <strong>T4A tax statement</strong> covering your full year of Movvy earnings goes out every February for the prior year.`,
    ),
    paragraph(`<em>— Movvy Partner Payments</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Payout Summary',
    heroHeadline: `${args.netDollars} hitting ${args.depositLandsOn}.`,
    bodyHtml,
    kind: 'partner',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'partner',
    templateKey: 'weeklyPayoutSummary',
  };
}
