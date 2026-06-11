# Movvy

The Uber for moving — connecting Calgary customers with vetted moving crews.

This repo contains the **full-stack MVP**: Expo/React Native mobile app + Supabase backend (Postgres + RLS + Edge Functions). Multi-city ready, security-first, designed for a public launch.

---

## Quick links

- **[BACKEND.md](BACKEND.md)** — architecture, role model, security guarantees, schema overview
- **[supabase/migrations/](supabase/migrations/)** — every SQL migration in execution order
- **[supabase/functions/](supabase/functions/)** — Edge Functions (Deno)
- **[src/lib/data/](src/lib/data/)** — TanStack Query hooks for every entity
- **[src/lib/validation/schemas.ts](src/lib/validation/schemas.ts)** — Zod schemas shared client ↔ server

---

## Architecture in one paragraph

React Native + Expo Router on the frontend. Supabase (Postgres, Auth, Storage, Edge Functions) on the backend. **Three layers of security on every write**: Zod on the client → Zod + auth + rate-limit in Edge Functions → CHECK constraints + Row-Level Security in Postgres. Tokens are 1-hour JWTs with rotated refresh tokens stored in iOS Keychain / Android Keystore. Every sensitive op writes to an immutable audit log. Money is stored in cents (integer) — never floats. Multi-city built into the schema from day 1.

---

## First-time setup

### Prereqs
- macOS with Node 20+ (`brew install node@20`)
- Watchman (`brew install watchman`) — required for the Metro file watcher
- A Supabase account (free tier is fine to start)
- iPhone or Android with **Expo Go** installed

### 1. Install dependencies

```bash
cd /Users/adamhmedat/Desktop/Movvy
npm install
```

### 2. Create your Supabase project

Detailed in [BACKEND.md → Step-by-step](BACKEND.md#step-by-step-bringing-your-supabase-project-online). Summary:

1. Go to https://supabase.com/dashboard → **New project**
2. Region: **Canada (Central) — ca-central-1**
3. Save the database password
4. Once provisioned, grab three values from **Project Settings → API**:
   - Project URL
   - anon public key
   - service_role key (server-only — keep secret)

### 3. Configure `.env.local`

```bash
cp .env.example .env.local
# Edit .env.local — paste your URL and anon key
```

### 4. Install + run the migrations

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_REF       # The xxxxxxxx in https://xxxxxxxx.supabase.co
supabase db push                           # Applies all 6 migrations + RLS + Calgary seed
```

You should see "Finished supabase db push" with ~22 tables created.

### 5. Deploy the sample Edge Function

```bash
supabase functions deploy bookings-create
```

### 6. Run the app

```bash
npx expo start
```

Then scan the QR code from Expo Go on your phone. The Mac and phone need to be on the same Wi-Fi (or use a tunnel: `npx expo start --tunnel`).

---

## What works end-to-end right now

| Flow | Frontend | Backend |
|---|---|---|
| **Customer signup** with email + verification | ✅ Real form, Zod-validated, strong password rules | ✅ Supabase Auth + auto-profile creation via trigger |
| **Customer login + session persistence** | ✅ AuthContext + iOS Keychain / Android Keystore | ✅ 1-hour JWT + rotated refresh tokens |
| **Forgot password** | ✅ Email reset flow | ✅ Supabase Auth |
| **Route guards** | ✅ Unauthed users redirected to welcome screen | — |
| **Customer profile** | ✅ Reads live `profiles` row, shows email verification status | ✅ RLS: only self-readable |
| **Customer home** | ✅ Real greeting, active-move banner from live data, move-history list | ✅ RLS-filtered query |
| **Booking history list** | ✅ Live bookings + pull-to-refresh, mock fallback for new accounts | ✅ RLS-filtered query |
| **Booking creation** (6-step flow) | ✅ Wired to edge function via `useCreateBooking` | ✅ `bookings-create` edge function: auth + Zod + rate limit + city service-area check + RLS insert + audit log |
| **Live tracking screen** | ✅ Fetches real booking by id with mock fallback | ✅ RLS: customer + assigned driver + admin |
| **Partner team onboarding** (driver + mover) | ✅ 2-person validation, submit triggers `useCreatePartnerTeam` | ✅ Creates `partner_teams` + `partner_team_members` rows |
| **Company onboarding** | ✅ HQ address autocomplete + driver roster, submit triggers `useCreateCompany` | ✅ Creates `companies` + `company_members` rows, stashes driver invites for next phase |
| **Calgary-only address autocomplete** | ✅ Nominatim with Calgary bounding box | — (no backend call) |
| **Live map (iOS / Android)** | ✅ Apple Maps / Google Maps via react-native-maps | — |
| **Logout** | ✅ Clears Keychain + invalidates session | ✅ Supabase Auth |

## What's intentionally on hold

Per discussion, these wait for explicit input or future phases:

- **Pricing logic** — placeholder zeros until you provide the official rate card. Once you do, the `bookings-create` edge function gets the real formula and pricing screen renders authoritative numbers.
- **Stripe payments** — Phase 3
- **Real-time driver location** (Supabase Realtime channels) — Phase 2
- **Chat (driver ↔ customer)** — Phase 5
- **Push notifications** (Expo Push) — Phase 5
- **Document upload to Supabase Storage** — currently the UI just marks "uploaded" locally; backend ingestion comes in Phase 4
- **Driver invite emails** for partner-team mover + company drivers — comes with the email service in Phase 5
- **Background checks** (Checkr) — Phase 4
- **Web admin dashboard deploy** (`admin.movvy.ca`) — exists as `app/(admin)/` screens; will deploy via `expo export --platform web` once data flows are wired

---

## Project layout

```
movvy/
├── app/                          Expo Router routes (file-based)
│   ├── _layout.tsx               Root: QueryClient + AuthProvider + Stack
│   ├── index.tsx                 Welcome / landing
│   ├── partner.tsx               Partner landing (driver/mover team vs company)
│   ├── (auth)/                   Real Supabase auth screens
│   ├── (customer)/               Customer tabs + booking flow + tracking
│   ├── (mover)/                  Partner-team onboarding + jobs + earnings
│   ├── (company)/                Company onboarding + dashboard + drivers + jobs
│   └── (admin)/                  Movvy ops dashboard (web target later)
├── src/
│   ├── components/               Shared UI primitives
│   ├── data/                     Mock data (used as fallback while wiring)
│   ├── lib/
│   │   ├── colors.ts
│   │   ├── format.ts
│   │   ├── pricing.ts            Client-side estimate (matches server formula)
│   │   ├── scheduling.ts         Lead-time + calendar helpers
│   │   ├── geocoding.ts          Nominatim wrapper (Calgary-bounded)
│   │   ├── validation/           Zod schemas shared with edge functions
│   │   ├── supabase/             Client, AuthContext, guards
│   │   └── data/                 TanStack Query hooks (profile, bookings, partners)
│   ├── store/                    Zustand state (booking draft, partner draft)
│   └── types/                    Shared TypeScript types
├── supabase/
│   ├── config.toml               Supabase project config (auth, rate limits, JWT TTL)
│   ├── migrations/
│   │   ├── 0001_core.sql         Cities, profiles, addresses, vehicles, enums
│   │   ├── 0002_partners.sql     Companies, partner_teams, members, documents
│   │   ├── 0003_bookings.sql     Bookings + status history + tracking + ratings + disputes + chat
│   │   ├── 0004_aux.sql          Audit logs, rate-limit buckets, promo codes, payouts, notifications
│   │   ├── 0005_rls.sql          Row-Level Security on every table + role helper functions
│   │   └── 0006_triggers_seed.sql State machine + short-code gen + Calgary seed
│   └── functions/
│       ├── _shared/              CORS, auth, rate-limit, audit utilities
│       └── bookings-create/      Template every public endpoint follows
├── BACKEND.md                    Architecture, security model, role matrix, schema overview
├── tailwind.config.js            Brand palette (white / black / silver / green)
└── app.json                      Expo config (plugins, scheme, secure-store)
```

---

## Daily dev workflow

```bash
npx expo start                   # Phone via Expo Go
npx expo start --web             # Browser preview at localhost:8081
npx expo start --clear           # Nuke Metro cache (after big dep changes)
supabase db push                 # Apply new migrations
supabase functions deploy NAME   # Deploy / redeploy an edge function
supabase functions logs NAME     # Tail logs for an edge function
```

---

## Color palette

White background `#FFFFFF`, ink (text) `#0A0A0A` → `#404040`, silver `#FAFAFA` → `#52525B`, brand green `#16A34A` primary with `#047857` deep accent.

---

## License

Proprietary — © Movvy. All rights reserved.
