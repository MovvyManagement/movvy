// =============================================================================
// Mover approved — the big "you're in" email. Sets expectations for the
// first job + reminds them where the in-app onboarding checklist lives.
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

export function moverApproved(args: {
  fullName?: string | null;
  /** Optional deep link into the in-app first-job onboarding screen. */
  appUrl?: string;
}): BrandedTemplate {
  const name = args.fullName?.split(' ')[0] ?? 'there';
  const subject = `🎉 You're approved — welcome to the Movvy crew`;

  const bodyHtml = [
    paragraph(`Hi ${escapeHtml(name)},`),
    paragraph(
      `Welcome to Movvy. You're <strong>approved</strong> and live on the platform. Job offers will start hitting your phone the moment a booking matches your service area + vehicle.`,
    ),
    paragraph(`<strong>Before your first job:</strong>`),
    stepList([
      {
        title: 'Set your availability',
        body: 'Open the Movvy app → Schedule → toggle the windows you\'re willing to work. You only get pinged when you\'re free.',
      },
      {
        title: 'Confirm your service area',
        body: 'Make sure your home base + radius are accurate — that\'s how we match you to nearby jobs.',
      },
      {
        title: 'Add your payout details',
        body: 'Profile → Payouts → bank info. Direct deposits land every Friday for the previous week\'s work.',
      },
    ]),
    args.appUrl ? buttonCta('Open Movvy', args.appUrl) : storeBadges(),
    paragraph(
      `A few quick reminders from the road:`,
    ),
    paragraph(
      `<strong>Show up early.</strong> 5 minutes before the pickup window = a 5-star review. Show up late = a one-star and a chat with our support team.`,
    ),
    paragraph(
      `<strong>Hit "We've left HQ" the moment you head out.</strong> That's when billing starts — both for you and the customer. Don't forget.`,
    ),
    paragraph(
      `<strong>Read the in-app safety guide</strong> (Profile → Safety). Two-person lifts, dolly use, stair handling — five minutes that saves you a back.`,
    ),
    paragraph(`Welcome aboard. — Movvy Partner Onboarding`),
  ].join('');

  const html = buildBrandedEmailHtml({
    title: subject,
    heroEyebrow: 'Approved',
    heroHeadline: `${name === 'there' ? 'You\'re' : `${name}, you're`} approved.`,
    bodyHtml,
    kind: 'partner',
  });

  return {
    subject,
    html,
    text: stripToText(html),
    kind: 'partner',
    templateKey: 'moverApproved',
  };
}
