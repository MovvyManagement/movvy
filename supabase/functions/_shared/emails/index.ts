// =============================================================================
// Barrel export — every template builder. Edge functions that need to send
// a specific email type just:
//
//   import { welcomeCustomer } from '../_shared/emails/index.ts';
//   await sendBrandedEmail({ to: user.email, template: welcomeCustomer({...}) });
//
// Keep this list in sync with the launch-set in docs/EMAIL_TEMPLATES.md.
// =============================================================================

export { welcomeCustomer } from './welcomeCustomer.ts';
export { bookingConfirmed } from './bookingConfirmed.ts';
export { bookingCancelled } from './bookingCancelled.ts';
export { moveComplete } from './moveComplete.ts';
export { accountDeleted } from './accountDeleted.ts';
export { moverApplicationReceived } from './moverApplicationReceived.ts';
export { moverApproved } from './moverApproved.ts';
export { moverApplicationDeclined } from './moverApplicationDeclined.ts';
export { docNeedsResubmission } from './docNeedsResubmission.ts';
export { weeklyPayoutSummary } from './weeklyPayoutSummary.ts';
export { passwordResetCode } from './passwordResetCode.ts';
