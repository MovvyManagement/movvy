# Movvy Stripe Connect sample

A reference Stripe Connect integration that mirrors the shape Movvy needs in
Phase 3: onboard partners as **V2 connected accounts**, list their **products**
at the platform level, and run customer purchases as **destination charges**
so Movvy keeps a platform fee.

Built as a standalone Node.js / Express app so the flow is easy to read top to
bottom without Expo or Supabase noise. When you wire this into the main app:

- Swap `lib/store.js` (JSON-on-disk) for Supabase writes against `profiles.stripe_account_id`
  and a new `products` table.
- Move the webhook handler into a Supabase Edge Function (`stripe-webhook`)
  using the same `stripeClient.parseThinEvent(...)` call.
- Replace the HTML form pages with screens inside `app/(company)/` and
  `app/(customer)/`.

## Setup

```bash
cd stripe-connect-sample
npm install

# 1. Fill in your test keys
cp .env.example .env
# Edit .env — paste your sk_test_… from https://dashboard.stripe.com/test/apikeys

# 2. In one terminal, run the server
npm run dev

# 3. In a second terminal, forward webhooks to it
npm run webhook:listen
# Copy the whsec_… it prints into your .env, then restart the server.
```

Open <http://localhost:4242>.

## Flow

1. **Onboard a partner** — `/onboard` creates a V2 connected account via the
   Accounts API (no top-level `type`; recipient configuration; dashboard
   `express`; Movvy as fees + losses collector). The "Onboard to collect
   payments" button mints a V2 account link and redirects.
2. **Create a product** — `/products` creates a Stripe Product on the platform
   account with a default Price, tagged in metadata with the connected
   account it pays out to.
3. **Buy something** — `/storefront` lists every product. The Buy button
   opens a Stripe Checkout session whose payment intent has
   `transfer_data.destination = <connected_account_id>` — that's the
   destination charge that monetizes the transaction.
4. **Webhook** — `/webhook` parses thin events with `parseThinEvent`, then
   `v2.core.events.retrieve(id)` to get the full payload. Handlers stub out
   the two events called for in the brief:
   - `v2.core.account[requirements].updated`
   - `v2.core.account[configuration.recipient].capability_status_updated`

## Files

```
stripe-connect-sample/
├── package.json
├── .env.example
├── README.md
├── server.js          # All routes + webhook handler
├── lib/
│   ├── stripe.js      # Shared stripeClient + getAccountStatus helper
│   ├── store.js       # JSON-file persistence (swap for Supabase later)
│   └── views.js       # HTML templates in Movvy's white/green palette
└── data/db.json       # Auto-created on first write
```

## Notes for production

- The brief recommends never caching onboarding status — `getAccountStatus`
  hits the Accounts API on every render of `/onboard`. Keep that posture in
  the real Movvy implementation.
- The `application_fee_amount` line in `/checkout` is commented out. Set it
  to `Math.round(unitAmount * 0.17)` once Movvy's commission rate is final
  (per `BACKEND.md`). The destination charge already routes funds; the fee
  field is what keeps Movvy's cut.
- `parseThinEvent` requires the **raw** request body. The `/webhook` route
  uses `express.raw` BEFORE the JSON body parser is mounted — keep that
  ordering when you port the handler to Supabase Edge Functions (Deno's
  default `Request.text()` already gives you the raw bytes).
