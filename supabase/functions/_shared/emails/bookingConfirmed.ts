// =============================================================================
// Booking confirmed — sent immediately after the customer hits "Book".
// Mirrors the in-app confirmation so the customer has a paper trail and
// the pickup window in their inbox.
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

export function bookingConfirmed(args: {
  fullName?: string | null;
  shortCode: string;
  pickupAddress: string;
  dropoffAddress: string;
  scheduledStart: string;        // human-readable, e.g. "Sat, May 24 · 8:00 AM"
  scheduledWindow: string;       // e.g. "8:00 AM – 12:00 PM"
  crewSize: number;
  estimatedTotalDollars: string; // e.g. "$1,420"
  bookingUrl: string;            // deep link into the app
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Your move is booked · ${args.scheduledStart} · #${args.shortCode}`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Your move is locked in. We'll match you with a vetted Movvy crew shortly and email you again the moment they're assigned.`,
    ),
    detailTable([
      { label: 'Booking #', value: args.shortCode },
      { label: 'When', value: args.scheduledStart },
      { label: 'Window', value: args.scheduledWindow },
      { label: 'Moving from', value: args.pickupAddress },
      { label: 'Moving to', value: args.dropoffAddress },
      { label: 'Crew', value: `${args.crewSize} movers` },
      { label: 'Estimated total', value: args.estimatedTotalDollars },
    ]),
    paragraph(
      `Your final total may differ from the estimate above — Movvy bills on actual hours worked, from "we've left HQ" to the last box off the truck.`,
    ),
    buttonCta('View Booking in App', args.bookingUrl),
    paragraph(
      `Need to change something? Open the booking in the app to reschedule or cancel — no fees up to 24 hours before your move.`,
    ),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Move Confirmed',
    heroHeadline: `See you ${args.scheduledStart.split(' ·')[0]}.`,
    bodyHtml,
    kind: 'customer',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'customer',
    templateKey: 'bookingConfirmed',
  };
}
