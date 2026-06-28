// =============================================================================
// Booking cancelled — sent on any cancellation path (customer-initiated,
// driver dropped, Movvy admin cancelled).
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

export function bookingCancelled(args: {
  fullName?: string | null;
  shortCode: string;
  scheduledStart: string;
  cancelledBy: 'customer' | 'driver' | 'movvy';
  reason?: string | null;
  refundedAmount?: string | null;   // "$0" if no money was held
  rebookUrl: string;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your move on ${args.scheduledStart} has been cancelled · #${args.shortCode}`;

  const explanation = {
    customer:
      'You cancelled this booking from the Movvy app. No fees were charged.',
    driver:
      'Your assigned crew had to drop the booking unexpectedly. We\'re finding you a new crew automatically — keep an eye on the app, or just rebook below.',
    movvy:
      'Movvy support cancelled this booking. We\'ll be in touch shortly with the reason and your next steps.',
  }[args.cancelledBy];

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(explanation),
    detailTable([
      { label: 'Booking #', value: args.shortCode },
      { label: 'Scheduled for', value: args.scheduledStart },
      ...(args.reason ? [{ label: 'Reason', value: args.reason }] : []),
      ...(args.refundedAmount
        ? [{ label: 'Refunded', value: args.refundedAmount }]
        : []),
    ]),
    buttonCta('Rebook Your Move', args.rebookUrl),
    paragraph(
      `Questions? Reply to this email and someone on our support team will get back to you within a few hours.`,
    ),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Move Cancelled',
    heroHeadline:
      args.cancelledBy === 'customer'
        ? 'Got it — your move is cancelled.'
        : 'Your move has been cancelled.',
    bodyHtml,
    kind: 'customer',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'customer',
    templateKey: 'bookingCancelled',
  };
}
