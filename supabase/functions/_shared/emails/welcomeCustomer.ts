// =============================================================================
// Welcome to Movvy — sent the moment a customer's signup OTP is verified.
// Goal: set expectations + push them toward booking their first move.
// =============================================================================

import {
  type BrandedTemplate,
  buildBrandedEmailHtml,
  buttonCta,
  escapeHtml,
  paragraph,
  stepList,
  storeBadges,
  stripToText,
} from '../email.ts';

export function welcomeCustomer(args: {
  fullName?: string | null;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `Welcome to Movvy, ${name} 👋`;
  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Welcome to Movvy — Alberta's easiest way to book a move. Vetted crews, honest hourly pricing, and live tracking from pickup to drop-off. Three taps and you're booked.`,
    ),
    paragraph(`<strong>Here's what to do next:</strong>`),
    stepList([
      {
        title: 'Open the app',
        body: 'Tap "Book a Move" on your home screen to get an instant estimate.',
      },
      {
        title: 'Tell us where + when',
        body: 'Pickup, drop-off, date — that\'s it. No quote calls.',
      },
      {
        title: 'Meet your crew',
        body: 'You\'ll see your mover\'s photo, rating, and arrival window the moment they accept.',
      },
    ]),
    buttonCta('Book Your First Move', 'https://movvy.ca'),
    paragraph(
      `Need anything? Just reply to this email and a human on our support team will get back to you.`,
    ),
    paragraph(`<em>— The Movvy team</em>`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Welcome',
    heroHeadline: `Hi ${name}, your move just got easier.`,
    bodyHtml,
    kind: 'customer',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'customer',
    templateKey: 'welcomeCustomer',
  };
}
