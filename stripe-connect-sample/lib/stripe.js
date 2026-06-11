// =============================================================================
// Stripe client singleton.
//
// The same `stripeClient` instance is reused for every API call across the
// app — products, accounts, account links, checkout sessions, webhook
// parsing, the lot. Stripe-Node already keeps a keep-alive HTTP agent
// internally so reusing the client is the recommended pattern.
//
// The Stripe API version that the SDK ships with is the latest at the time
// the SDK was published. We don't pin one manually — per the integration
// brief, we let the SDK negotiate it. The newest preview version
// (2026-05-27.dahlia) is what stripe-node@22+ targets.
// =============================================================================

import Stripe from 'stripe';

const apiKey = process.env.STRIPE_SECRET_KEY;

if (!apiKey || apiKey === 'sk_test_replace_me') {
  // Fail loudly at boot. A missing key would otherwise surface as a
  // confusing 401 from Stripe on the first request — much harder to
  // diagnose than a clear startup error.
  throw new Error(
    'STRIPE_SECRET_KEY is missing or still set to the placeholder.\n' +
      '→ Copy .env.example to .env and paste your test secret key from\n' +
      '  https://dashboard.stripe.com/test/apikeys',
  );
}

// One client. Reused everywhere.
export const stripeClient = new Stripe(apiKey);

// =============================================================================
// Helper: read the live onboarding status of a connected account.
//
// Per the integration brief, status comes straight from the Accounts API —
// we never cache it. The two flags we care about:
//
//   • readyToReceivePayments — recipient configuration's stripe_transfers
//                              capability is fully active.
//   • onboardingComplete     — requirements summary shows nothing in the
//                              `currently_due` or `past_due` bucket.
//
// Both are surfaced on the partner onboarding page so they can see what
// they still need to do without us needing to mirror Stripe's state.
// =============================================================================
export async function getAccountStatus(accountId) {
  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    // Pull both configurations — the recipient side governs payouts, the
    // merchant side governs card-payment association. Both must be active
    // before destination charges will settle cleanly.
    include: ['configuration.recipient', 'configuration.merchant', 'requirements'],
  });

  const transfersStatus =
    account?.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status ?? 'inactive';

  const cardPaymentsStatus =
    account?.configuration?.merchant?.capabilities?.card_payments?.status ??
    'inactive';

  const requirementsStatus =
    account?.requirements?.summary?.minimum_deadline?.status ?? null;

  // The brief defines "ready to receive payments" as transfers-active, and
  // that's still the gating signal for payouts. We surface card_payments
  // separately so the UI can show partial-progress states.
  const readyToReceivePayments = transfersStatus === 'active';
  const onboardingComplete =
    requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';

  return {
    account,
    readyToReceivePayments,
    onboardingComplete,
    transfersStatus,
    cardPaymentsStatus,
    requirementsStatus,
  };
}
