// =============================================================================
// Movvy Stripe Connect sample — Express server.
//
// One file holds every route so the flow is easy to follow top-to-bottom:
//
//   GET  /                  → landing page + counts
//   GET  /onboard           → list partners + live onboarding status
//   POST /onboard/create    → create a V2 connected account (recipient config)
//   POST /onboard/link      → mint a V2 account link, redirect to Stripe
//   GET  /products          → list + create products
//   POST /products/create   → create a platform-level product + default price
//   GET  /storefront        → buyer-facing catalogue across every partner
//   POST /checkout          → create a destination-charge Checkout session
//   GET  /success           → post-checkout confirmation
//   POST /webhook           → thin-event handler for v2.account.* changes
//
// Every Stripe call routes through the shared `stripeClient` from lib/stripe.js
// per the integration brief. Persistence is JSON-on-disk; swap for Supabase
// when wiring into the main app.
// =============================================================================

import 'dotenv/config';
import express from 'express';
import { stripeClient, getAccountStatus } from './lib/stripe.js';
import {
  listUsers,
  getUser,
  getUserByAccountId,
  createUser,
  listProducts,
  createProduct,
  getProduct,
} from './lib/store.js';
import {
  homeView,
  onboardView,
  productsView,
  storefrontView,
  successView,
  errorView,
} from './lib/views.js';

const PORT = Number(process.env.PORT ?? 4242);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const app = express();

// =============================================================================
// /webhook must be mounted BEFORE the JSON body parser so we can read the
// raw bytes Stripe signed. The signing-secret check fails otherwise.
// =============================================================================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'whsec_replace_me') {
      // Don't 500 — Stripe would retry. 200 with a body the operator sees.
      console.warn(
        '[webhook] STRIPE_WEBHOOK_SECRET missing. Start the CLI with `npm run webhook:listen` and paste the printed whsec_… into your .env',
      );
      return res.status(200).send('webhook secret not configured');
    }
    const signature = req.headers['stripe-signature'];
    let thinEvent;
    try {
      // parseThinEvent verifies the signature AND decodes the lightweight
      // payload Stripe sends for V2 thin destinations.
      thinEvent = stripeClient.parseThinEvent(req.body, signature, WEBHOOK_SECRET);
    } catch (err) {
      console.error('[webhook] signature verification failed', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // Thin events carry only ids — fetch the full event for context.
      const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);

      console.log(`[webhook] received ${event.type}`);

      switch (event.type) {
        case 'v2.core.account[requirements].updated': {
          // The set of `currently_due` / `past_due` requirements has changed.
          // In Movvy we'd: re-fetch the account, update the partner's
          // `onboarding_status` column, and surface a push notification if
          // they have new items to upload.
          const accountId = event?.related_object?.id ?? event?.data?.account?.id;
          if (accountId) {
            const status = await getAccountStatus(accountId);
            console.log(
              `[webhook] requirements for ${accountId}:`,
              status.requirementsStatus,
              status.readyToReceivePayments ? '(accepting payments)' : '',
            );
          }
          break;
        }
        case 'v2.core.account[configuration.recipient].capability_status_updated':
        case 'v2.core.account[configuration.merchant].capability_status_updated': {
          // A capability on one of the two configurations flipped state:
          //   • recipient.stripe_transfers → governs payouts to the partner
          //   • merchant.card_payments    → required to associate the
          //                                  account with card processing
          // When BOTH go `active` the partner can transact end-to-end. In
          // Movvy we'd update the partner's `payouts_enabled` /
          // `card_payments_enabled` columns and unblock the "go online"
          // toggle in the driver app.
          const accountId = event?.related_object?.id ?? event?.data?.account?.id;
          if (accountId) {
            const status = await getAccountStatus(accountId);
            console.log(
              `[webhook] capability update for ${accountId}: transfers=${status.transfersStatus} cardPayments=${status.cardPaymentsStatus}`,
            );
          }
          break;
        }
        default:
          console.log(`[webhook] unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[webhook] handler error', err);
      // 200 prevents Stripe from retrying a permanent failure indefinitely.
      // For transient failures you'd return 500 here so Stripe retries.
      res.status(200).json({ received: true, error: 'handler-error-see-logs' });
    }
  },
);

// JSON + url-encoded body parsers for the rest of the routes.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =============================================================================
// Home
// =============================================================================
app.get('/', async (_req, res) => {
  const users = await listUsers();
  const products = await listProducts();
  res.send(homeView({ users, products }));
});

// =============================================================================
// Onboarding — list, create account, mint account link
// =============================================================================
app.get('/onboard', async (req, res) => {
  const users = await listUsers();
  // Live status for each partner. Per the brief, never cache — always read
  // from the Accounts API on the request that needs it.
  const statuses = {};
  await Promise.all(
    users.map(async (u) => {
      try {
        statuses[u.id] = await getAccountStatus(u.accountId);
      } catch (e) {
        statuses[u.id] = { error: e.message };
      }
    }),
  );
  res.send(onboardView({ users, statuses, error: req.query.error }));
});

app.post('/onboard/create', async (req, res) => {
  const { displayName, contactEmail } = req.body;
  if (!displayName || !contactEmail) {
    return res.redirect('/onboard?error=Display+name+and+email+are+required');
  }
  try {
    // V2 connected account. The brief is explicit: do NOT pass a top-level
    // `type`. Platform handles fees + losses, dashboard is express, and the
    // recipient configuration requests stripe_transfers so the partner can
    // receive destination charges.
    const account = await stripeClient.v2.core.accounts.create({
      display_name: displayName,
      contact_email: contactEmail,
      identity: {
        country: 'us',
      },
      dashboard: 'express',
      defaults: {
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      configuration: {
        // The recipient configuration is what lets the connected account
        // RECEIVE funds (the destination half of a destination charge).
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {
                requested: true,
              },
            },
          },
        },
        // The merchant configuration is what lets the connected account
        // be associated with card payments. Stripe rejects an account
        // that only has the recipient half — `stripe_transfers` requires
        // `card_payments` to be requested in tandem. The account itself
        // doesn't necessarily process the card (the platform does, via
        // destination charges), but Stripe still wants this capability
        // present for compliance / network requirements.
        merchant: {
          capabilities: {
            card_payments: {
              requested: true,
            },
          },
        },
      },
    });

    // Persist the user→account mapping. In Movvy this would be a Supabase
    // update on `profiles.stripe_account_id` for the signed-in partner.
    await createUser({
      displayName,
      contactEmail,
      accountId: account.id,
    });

    res.redirect('/onboard');
  } catch (err) {
    console.error('[create account] failed', err);
    res.redirect(`/onboard?error=${encodeURIComponent(err.message)}`);
  }
});

app.post('/onboard/link', async (req, res) => {
  const { userId } = req.body;
  const user = await getUser(userId);
  if (!user) {
    return res.redirect('/onboard?error=Unknown+user');
  }
  try {
    const accountLink = await stripeClient.v2.core.accountLinks.create({
      account: user.accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          // Both configurations get onboarded in the same hosted flow.
          // Matches the capabilities requested at account-creation time.
          configurations: ['recipient', 'merchant'],
          // Stripe redirects here if the user hits "refresh" or the link
          // expires mid-flow. Sending them back to /onboard makes them
          // click the button again, which mints a fresh link.
          refresh_url: `${PUBLIC_BASE_URL}/onboard`,
          // After they finish (or close the tab), they land back on
          // /onboard?accountId=... so we can surface the latest status.
          return_url: `${PUBLIC_BASE_URL}/onboard?accountId=${user.accountId}`,
        },
      },
    });
    res.redirect(accountLink.url);
  } catch (err) {
    console.error('[account link] failed', err);
    res.redirect(`/onboard?error=${encodeURIComponent(err.message)}`);
  }
});

// =============================================================================
// Products — create at platform level + list
// =============================================================================
app.get('/products', async (req, res) => {
  const users = await listUsers();
  const products = await listProducts();
  res.send(productsView({ users, products, error: req.query.error }));
});

app.post('/products/create', async (req, res) => {
  const { name, description, unitAmount, currency, connectedAccountId } = req.body;
  const owner = await getUserByAccountId(connectedAccountId);
  if (!owner) {
    return res.redirect(
      `/products?error=${encodeURIComponent('Pick a known connected account')}`,
    );
  }
  const amountCents = Number.parseInt(unitAmount, 10);
  if (!Number.isFinite(amountCents) || amountCents < 1) {
    return res.redirect(
      `/products?error=${encodeURIComponent('Unit amount must be a positive integer (in cents)')}`,
    );
  }

  try {
    // Product is created on the PLATFORM account (no Stripe-Account header).
    // We tag it with the connected account id via metadata so the storefront
    // and checkout can route the destination charge correctly.
    const product = await stripeClient.products.create({
      name,
      description: description || undefined,
      default_price_data: {
        unit_amount: amountCents,
        currency: (currency ?? 'usd').toLowerCase(),
      },
      metadata: {
        connected_account_id: connectedAccountId,
      },
    });

    // Persist locally — Movvy would write to a `products` table with a
    // foreign key to the partner profile.
    await createProduct({
      id: product.id,
      name,
      description,
      priceId: product.default_price, // returned by Stripe once default_price_data is provided
      unitAmount: amountCents,
      currency: (currency ?? 'usd').toLowerCase(),
      connectedAccountId,
    });

    res.redirect('/products');
  } catch (err) {
    console.error('[products/create] failed', err);
    res.redirect(`/products?error=${encodeURIComponent(err.message)}`);
  }
});

// =============================================================================
// Storefront — buyer-facing list + Checkout creation
// =============================================================================
app.get('/storefront', async (_req, res) => {
  const users = await listUsers();
  const products = await listProducts();
  res.send(storefrontView({ users, products }));
});

app.post('/checkout', async (req, res) => {
  const { productId } = req.body;
  const product = await getProduct(productId);
  if (!product) {
    return res.status(404).send(errorView('Unknown product'));
  }

  try {
    // Destination charge. The customer pays Movvy (the platform); Stripe
    // automatically transfers the funds to the connected account named in
    // payment_intent_data.transfer_data.destination. Add an
    // `application_fee_amount` here when you wire the official Movvy
    // commission split (e.g. 17% per BACKEND.md).
    const session = await stripeClient.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          // We pass price_data inline so changes to the product price in
          // our DB don't require recreating the Stripe Price object. If
          // you prefer the canonical Price id, use { price: product.priceId, quantity: 1 }.
          price_data: {
            currency: product.currency,
            unit_amount: product.unitAmount,
            product_data: {
              name: product.name,
              description: product.description || undefined,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        transfer_data: {
          destination: product.connectedAccountId,
        },
        // Example fee — uncomment to take a 17% cut on top of the destination
        // transfer. Movvy's BACKEND.md spec uses this percentage.
        // application_fee_amount: Math.round(product.unitAmount * 0.17),
      },
      success_url: `${PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_BASE_URL}/storefront`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('[checkout] failed', err);
    res.status(500).send(errorView(err.message));
  }
});

app.get('/success', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect('/storefront');
  try {
    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    res.send(successView({ session }));
  } catch (err) {
    res.status(500).send(errorView(err.message));
  }
});

// =============================================================================
// Startup
// =============================================================================
app.listen(PORT, () => {
  console.log(`Movvy Stripe Connect sample → ${PUBLIC_BASE_URL}`);
  console.log(
    '  Webhook: POST /webhook  (start `npm run webhook:listen` in another tab)',
  );
});
