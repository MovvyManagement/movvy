# Movvy Backend — Phase 1 Foundation

This doc explains the backend architecture, security model, and how to bring
your Supabase project online with the migrations + edge functions in this repo.

---

## Architecture at a glance

```
┌───────────────┐  HTTPS + JWT   ┌──────────────────┐
│ React Native  │ ─────────────▶ │ Supabase Auth    │  1-hour access tokens
│ Mobile App    │                │  (PKCE flow)     │  30-day refresh tokens
└───────┬───────┘                └────────┬─────────┘  (rotated on use)
        │                                 │
        │  PostgREST + RLS                ▼
        │                        ┌──────────────────┐
        ├──────────────────────▶ │ Postgres + RLS   │ ◀── DB triggers enforce
        │                        │ (Supabase)       │     status state machine
        │                        └────────┬─────────┘     + lock booking fields
        │                                 │              + auto-write audit log
        │  Sensitive actions             │
        │  (price calc, refunds, etc.)   ▼
        │                        ┌──────────────────┐
        └──────────────────────▶ │ Edge Functions   │ ◀── Zod validation
                                 │ (Deno, server-   │     Rate limit
                                 │  side only)      │     Audit log
                                 │                  │     service_role for DB
                                 └──────────────────┘
                                          │
                                          ▼
                                ┌──────────────────────┐
                                │ Stripe / Maps / etc. │  Secrets never leave server
                                └──────────────────────┘
```

---

## Three security layers (defense in depth)

Every write to the database is protected by **all three** layers. An attacker
would need to bypass all three to inject bad data — extremely unlikely.

| Layer | What it does | Where |
|---|---|---|
| **1. Zod (client)** | Friendly form validation, UX feedback | [src/lib/validation/schemas.ts](src/lib/validation/schemas.ts) |
| **2. Zod + auth + rate-limit (edge function)** | Re-validate every input. Never trust the client. | [supabase/functions/*/index.ts](supabase/functions/) |
| **3. Postgres CHECK + RLS (database)** | Final gate. Even with service_role compromised, RLS + CHECK constraints reject malformed rows. | [supabase/migrations/0005_rls.sql](supabase/migrations/0005_rls.sql) |

---

## Role model

| Role | Can do |
|---|---|
| `customer` | Create/view own bookings, rate partners, open disputes, save addresses + payment methods |
| `driver` | Member of a partner_team or company. Sees only assigned bookings. Updates status. |
| `mover` | Member of a partner_team. Sees only assigned bookings via the team. |
| `company_owner` | Manage company + drivers, accept jobs on behalf of company |
| `company_dispatcher` | Same as owner but cannot delete the company |
| `movvy_admin` | Full read/write on every table. Refunds, role changes, manual assignments. |
| `movvy_support` | Read everything, write to chat + disputes only. Cannot refund. |

Roles are stored in `profiles.role` (and mirrored to `auth.users.app_metadata`
for fast JWT checks). A customer **cannot self-promote** — the RLS policy
`profiles_update_own` explicitly prevents role changes by the user themselves.

---

## Pricing engine (Phase 2 lock-in)

Customer-facing rate card and Movvy take, all enforced **server-side** in the
`bookings-create` edge function. Client-side `estimatePrice()` exists for the
estimate screen only — the server never trusts the client total.

### Residential rate matrix (home_move)

| Selection | Crew | Hours | **Customer rate** | **Driver rate** (80%) |
|---|---|---|---|---|
| 1-bed apartment / condo | 2 | 6 | $175/hr | $140/hr |
| 2-bed apartment / condo | 2 | 8 | $175/hr | $140/hr |
| 3-bed apartment / condo | 3 | 10 | $225/hr | $180/hr |
| 2-bed townhouse / house | 2 | 8 | $175/hr | $140/hr |
| 3-bed townhouse / house | 3 | 10 | $225/hr | $180/hr |
| 4-bed townhouse / house | 3 | 12 | $225/hr | $180/hr |
| 4+ bed apt / 5+ bed house | extrapolated (+2 hr per extra bed) | — | $225/hr | $180/hr |

### Commercial rate matrix

4+ crew mandates a **second truck** even if it isn't actively moving stuff —
that's why there's a $150/hr jump from 3-crew to 4-crew.

| Crew | Trucks (mandatory) | **Customer rate** | **Driver rate** (80%) |
|---|---|---|---|
| 2 | 1 truck | $200/hr | $160/hr |
| 3 | 1 truck | **$250/hr** | $200/hr |
| 4 | 2 trucks | **$400/hr** | $320/hr |
| 5 | 2 trucks | **$450/hr** | $360/hr |
| 6 | 2 trucks | **$500/hr** | $400/hr |
| 7+ | 2 trucks | +$50/hr per extra person | (80%) |

Customer chooses estimated hours; rate determined by crew size.

### Travel, materials, add-ons

| Line item | Customer | Driver / Movvy split |
|---|---|---|
| **Travel** (non-intra-city) | `ceil(((HQ→pickup→dropoff km / 80 km/h) + 0.5 hr) × 2) / 2`, billed at the same hourly rate | Driver 80% · Movvy 20% |
| **Travel** (intra-Calgary or intra-Edmonton) | 1 hr flat at the same rate | Driver 80% · Movvy 20% |
| **Packing service** | +2 hr on-site time | — |
| **Packing materials** | **Flat $50** (regardless of packing) | **Driver $30 flat** · Movvy keeps $20 |
| **4-hour job minimum** | Every job is billed for at least 4 hr total (travel + on-site). If actual is shorter, on-site is padded up. | — |
| **Moving insurance** | +$30 if opted in | **Movvy 100%** (Movvy carries the policy) |
| **GST (5%)** | On (service + travel + materials + insurance) | — |
| **Total** | Rounded **up** to nearest $1 | — |
| **Deposit (non-refundable)** | `ceil(total × 0.20)`, charged at booking | Subtracted from final |
| **Balance** | Captured when job is marked complete; can go up/down with actual hours | — |
| **Tip** (optional, post-completion) | Customer-chosen | **Driver 90% · Movvy 10%** |

### Funds flow

Customer pays Movvy (Stripe in Phase 3) → Movvy queues a `driver_payouts` row
when booking flips to `completed` → tip arriving later automatically bumps the
same payout row via the `bookings_bump_payout_on_tip` trigger → weekly Stripe
Connect transfer drains pending payouts to the team / company / driver.

Every booking row carries the full breakdown in its own column
(`service_cost_cents`, `driver_earnings_cents`, `movvy_margin_cents`, `fuel_cents`,
`materials_cents`, `scale_charge_cents`, `accommodation_cents`,
`service_tax_cents`, `materials_tax_cents`, `deposit_cents`, …) so the admin
dashboard can audit any booking's math from raw DB rows.

## Status flow (5 driver flags + customer notifications)

The driver UI exposes **5 buttons** that map onto the booking state machine.
Every status transition writes an `in_app` notification to the customer via
the `notify_customer_on_status_change` trigger.

| Driver flag | Booking status | Customer notification |
|---|---|---|
| Left HQ | `assigned/confirmed` → `on_the_way` | "Your crew is on the way" |
| Arrived at pickup | `on_the_way` → `arrived` → `loading` | "Your crew has arrived" |
| Loaded · heading to drop-off | `loading` → `in_transit` | "On the way to drop-off" |
| Arrived at drop-off | `in_transit` → `unloading` | "Arrived · unloading" |
| Job done | `unloading` → `completed` | "Move complete! Tap to rate." |

While `on_the_way`, the customer's tracking screen shows the **pickup address**
as the target and a live ETA. While `in_transit`, it switches to the
**drop-off address**. ETA is recomputed every time the driver's GPS ping
arrives via Supabase Realtime (`booking_tracking` table).

## Edge Functions (deployed)

| Function | Purpose | Rate limit |
|---|---|---|
| `bookings-create` | Customer creates a draft booking (auth + city-area check + Zod + RLS insert + audit) | 5 / hr / user |
| `bookings-update-status` | Driver progresses move through state machine | 60 / hr / user |
| `bookings-cancel` | Customer cancels; refund % computed server-side from time-until-move | 10 / hr / user |
| `bookings-accept` | Partner team / company driver claims a `searching` job (atomic) | 30 / min / user |
| `ratings-submit` | Either party rates after a completed booking (immutable) | 20 / hr / user |
| `tracking-ping` | Driver sends GPS during active job → Realtime to customer | 720 / hr / user |
| `documents-upload-url` | Returns short-lived signed Storage upload URL + pre-registers `verification_documents` row | 30 / hr / user |
| `geocoding-search` | Cost-protected address autocomplete proxy (Google + cache + budget + Nominatim fallback) | 30/min/user, 200/day/user |
| `tips-submit` | Customer adds tip to a completed move; 90% to driver, 10% to Movvy; auto-bumps `driver_payouts` | 30 / hr / user |

## Third-party API cost protection

The hardest-to-undo problem in a marketplace app is a leaked or abused paid
API key. Movvy defends in three layers (see [CLAUDE_SAFETY.md](CLAUDE_SAFETY.md)
for the full rule book):

1. **Google Cloud Console** — referrer/IP restrictions, per-API quotas, billing alerts
2. **Supabase DB** — `feature_flags` (default OFF), `api_budgets` (default $5/day),
   `api_spend_log` (every call costed), `api_cache` (1h TTL)
3. **Edge Function** — auth + multi-axis rate limit + cache + budget + flag check before any paid call. Falls back to free Nominatim if any guard fails.

Worst-case daily spend on any paid Google API = `api_budgets.daily_cap_usd`.
Default is **$5/day** per service. Raise it as you scale.

### Emergency kill switches

| Action | SQL |
|---|---|
| Disable all Google calls instantly | `update feature_flags set enabled=false where key like 'google_%';` |
| Zero out today's budget | `update api_budgets set daily_cap_usd=0 where service like 'google_%';` |
| See today's spend | `select service, sum(cost_usd), count(*) from api_spend_log where created_at >= date_trunc('day', now()) group by service;` |
| Rotate Supabase service_role | Dashboard → Settings → API → Rotate |
| Disable Google API key | Cloud Console → Credentials → DISABLE |

Deploy them all in one shot: `./scripts/deploy-functions.sh`

## Rate limits (in place now)

| Endpoint / action | Limit | Window | Bucket key |
|---|---|---|---|
| Auth signup | 30 | 1 hour | per IP (Supabase built-in) |
| Auth login | 30 | 5 min | per IP (Supabase built-in) |
| Password reset email | 1 | 1 min | per email (Supabase built-in) |
| Token refresh | 150 | 5 min | per IP (Supabase built-in) |
| `bookings-create` | 5 | 1 hour | per user (DB-backed via `rl_check_and_increment`) |
| `bookings-update-status` | 60 | 1 hour | per user |
| `bookings-cancel` | 10 | 1 hour | per user |
| `bookings-accept` | 30 | 1 min | per user |
| `ratings-submit` | 20 | 1 hour | per user |
| `tracking-ping` | 720 | 1 hour | per user |
| `documents-upload-url` | 30 | 1 hour | per user |

## Storage buckets (in place now)

| Bucket | Public? | Size cap | Allowed types | RLS |
|---|---|---|---|---|
| `verifications` | No | 20 MB | JPEG/PNG/HEIC/WebP/PDF | Owner-only + admin |
| `profile-photos` | No | 5 MB | JPEG/PNG/HEIC/WebP | Owner-only |
| `move-photos` | No | 15 MB | JPEG/PNG/HEIC/WebP/MP4/MOV | Booking participants only |
| `company-photos` | No | 5 MB | JPEG/PNG/WebP | Company members |

Path conventions are enforced by RLS — e.g. uploading to `verifications/X/...` requires the uploader's auth.uid() to equal `X`.

The DB-backed limiter is fast enough for early traffic. Migrate to
**Upstash Redis sliding window** in Phase 6 (hardening) for sub-millisecond
checks at scale.

---

## Short-lived credentials

| Credential | Lifetime | Refresh |
|---|---|---|
| Supabase access token (JWT) | 1 hour | Auto-refresh via refresh token |
| Supabase refresh token | 30 days max | Rotated on every use; reuse window 10 sec |
| Stripe restricted keys | N/A (key) | Rotated quarterly + on any incident |
| Google Maps key | N/A | Restricted to server IP + edge function origin only |
| Stripe customer ephemeral key | 1 hour | Generated per payment sheet by edge function |

Mobile app never sees `service_role`, Stripe secret, or Maps key. They live in:
- `supabase secrets set ...` (for edge functions)
- `.env.local` (your dev machine — gitignored)

---

## Database schema overview

```
cities  ──────────┬─ profiles ─────────┬─ saved_addresses
                  │                    └─ device_tokens
                  │
                  ├─ partner_teams ────┬─ partner_team_members  (driver + mover)
                  │                    └─ verification_documents
                  │
                  ├─ companies ────────┬─ company_members
                  │                    ├─ vehicles
                  │                    └─ verification_documents
                  │
                  └─ bookings ─────────┬─ booking_status_history (auto-written)
                                       ├─ booking_tracking       (live GPS pings)
                                       ├─ ratings                (immutable)
                                       ├─ disputes
                                       ├─ chat_threads / messages
                                       └─ promo_redemptions

audit_logs              ── append-only; service_role write only
rate_limit_buckets      ── service_role only
payouts                 ── partner reads own; admin all
notifications           ── user reads own
```

All money is stored as **integer cents** (never floats) to avoid rounding bugs.

---

## Step-by-step: bringing your Supabase project online

### 1. Get your keys

After creating the project on supabase.com, **Project Settings → API**:
- **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
- **anon public** key → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → keep for Edge Function secrets (do not paste in `.env.local` checked into Expo bundle paths)

### 2. Create `.env.local`

```bash
cp .env.example .env.local
# Edit .env.local with your real values
```

### 3. Install Supabase CLI

```bash
brew install supabase/tap/supabase
```

### 4. Link your project

```bash
supabase login                     # opens browser
supabase link --project-ref YOUR_REF
```

`YOUR_REF` is the part of your URL between `https://` and `.supabase.co`.

### 5. Run the migrations

```bash
supabase db push
```

This applies `supabase/migrations/0001…0006.sql` in order. Should take ~5 sec.
Verify in Supabase Studio (Table Editor) that you see ~22 tables.

### 6. Deploy Edge Functions

```bash
# Set secrets (service_role is already in the project, just confirm)
supabase secrets set SUPABASE_URL=https://YOUR-REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=ey...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=ey...

# Deploy the sample function
supabase functions deploy bookings-create
```

### 7. Restart the Expo app

```bash
npx expo start --clear
```

Now sign up flows through real Supabase Auth. A confirmation email arrives;
clicking the link verifies + lets you sign in.

---

## What works today

- ✅ Real signup / login / password reset via Supabase Auth
- ✅ Strict input validation (Zod) on every auth form, client + server-side
- ✅ Strong password policy (10 chars, mixed case, digit)
- ✅ Secure token storage (iOS Keychain / Android Keystore via expo-secure-store)
- ✅ PKCE auth flow (no client secret on mobile)
- ✅ Auto-refreshing 1-hour JWTs
- ✅ RLS policies on every table — even if a client crafted a malicious request, the DB rejects it
- ✅ Booking status state machine — invalid transitions raise an error at the DB level
- ✅ Audit log of every status change (automatic)
- ✅ Rate limiting on the sample `bookings-create` edge function
- ✅ Multi-city ready (Calgary seeded; add new cities via SQL or admin UI later)
- ✅ Per-city pricing config (commission, tax, rates) stored in DB — not hardcoded
- ✅ Calgary service-area gating: bookings must be inside the city bounds

## What's coming in later phases

- ⏳ Pricing logic (waiting on your official rate card)
- ⏳ Booking creation flow in the app wired to the edge function
- ⏳ Mover matching / dispatch algorithm
- ⏳ Stripe payment intents + Stripe Connect for partner payouts
- ⏳ Google Maps Directions + Distance Matrix proxy
- ⏳ Realtime tracking (Supabase Realtime channels)
- ⏳ Expo Push notifications
- ⏳ Web admin dashboard deploy (`admin.movvy.app` — uses existing app/(admin)/ screens via `expo export --platform web`)
- ⏳ Checkr API for background checks
- ⏳ Sentry crash reporting + structured logging
- ⏳ Move to Upstash Redis for rate limiting at scale
- ⏳ Twilio voice/SMS proxy (mask phone numbers between customer + driver)
- ⏳ Penetration testing + security review before live payments
