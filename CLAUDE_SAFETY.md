# CLAUDE_SAFETY.md — rules for not racking up a bill

This file is the rule book for **Claude (and any human dev)** working on Movvy.
It exists for one reason: **paid APIs can cost thousands of dollars per day if
misconfigured**, and you (the owner) explicitly asked that I not run up a bill.

Anyone — human or AI — modifying this codebase MUST read this first.

---

## TL;DR rules

1. **NEVER paste real production API keys in the chat.** Drop them in `.env.local` yourself or use `supabase secrets set` from your own terminal.
2. **Claude does not execute paid-API calls during development.** Not `curl`, not test scripts, not `npm test` that hits real Google. If a feature needs validation against a paid API, Claude writes the code + asks the user to test it themselves with a single canary request.
3. **Every paid API has a default-OFF feature flag.** Code must check the flag before spending. The flag lives in `feature_flags` (DB) and defaults to `false`.
4. **Every paid API has a daily $ budget cap.** Code must check `api_budget_check(service)` and respect `allowed=false` by falling back to a free alternative or returning an error.
5. **The mobile app NEVER calls a paid API directly.** All calls go through an edge function that enforces rate limit + cache + budget.

---

## Where keys live (and never live)

| Key | Belongs in | Forbidden in |
|---|---|---|
| Supabase publishable / anon key | `.env.local` + ships in mobile bundle (by design) | — |
| Supabase **service_role / secret** key | Supabase Functions secrets only | Mobile bundle, `EXPO_PUBLIC_*`, git, chat |
| Google Maps server key | Supabase Functions secrets only | Mobile bundle, `EXPO_PUBLIC_*`, git, chat |
| Stripe secret key | Supabase Functions secrets only | Mobile bundle, git, chat |
| Stripe webhook secret | Supabase Functions secrets only | Mobile bundle, git, chat |
| Twilio auth token | Supabase Functions secrets only | Mobile bundle, git, chat |
| Checkr API key | Supabase Functions secrets only | Mobile bundle, git, chat |

Rule of thumb: **if a key is prefixed `EXPO_PUBLIC_`, treat it as public.** If
it's not, it must NEVER appear in:
- Any file under `app/` or `src/`
- Any `EXPO_PUBLIC_*` env var
- Any console.log
- Any git commit
- Any chat message

The `.gitignore` blocks `.env*` files (except `.env.example`). Pre-commit hooks
(when you add them) should grep for `sk_live_`, `sk_test_`, `sb_secret_`,
`AIzaSy`, `whsec_` and reject the commit.

---

## What costs money (and how much)

| API | Per-call cost | Free tier | Movvy uses it for |
|---|---|---|---|
| **Google Places Autocomplete** | $2.83 / 1k (session-token pricing) | $200/mo credit ≈ 100k req | Address suggestions while typing |
| **Google Place Details** | $17 / 1k | (in free credit) | Resolving a selected suggestion → coords |
| **Google Geocoding API** | $5 / 1k | (in free credit) | Address ↔ coords |
| **Google Directions** | $5 / 1k | (in free credit) | Route + ETA for tracking |
| **Google Distance Matrix** | $5 / 1k | (in free credit) | Distance & duration for pricing |
| **Stripe** | 2.9% + $0.30 / charge | — | Payments |
| **Twilio SMS (CA)** | $0.0079 / msg | — | Phone-number masking proxy |
| **Twilio Voice (CA)** | $0.013 / min | — | Voice calls between customer ↔ driver |
| **Checkr basic check** | $25–$60 / check | — | Background checks for drivers |
| **Expo Push** | Free | ~600 / sec | Push notifications |
| **Sentry** | Free dev tier; ~$26/mo for prod | — | Error monitoring |
| **Nominatim (OpenStreetMap)** | **FREE** | 1 req/sec fair use | Default address autocomplete |
| **Supabase Free Tier** | Free up to 500MB DB + 2GB egress | — | Everything else |

A motivated attacker hitting an unprotected Google Maps key could burn **$10,000+
in a single day**. This is not theoretical — it happens. Always check that:
- The key is restricted in Google Cloud Console (HTTP referrers + IP + per-API)
- Daily caps are set in Google Cloud Console itself (separate from Movvy's caps)
- Movvy's feature flag is OFF by default
- Movvy's daily budget cap is conservative ($5/day to start)
- Every endpoint that uses it has tight per-user + per-IP rate limits

---

## The three layers of API cost protection

### 1. Google Cloud Console (the API provider's own gate)

Configure these BEFORE creating the key:

- **Application restrictions**: HTTP referrers (`https://movvy.app/*`,
  `https://*.supabase.co/*`) OR IP addresses (your Supabase project IPs)
- **API restrictions**: enable only the specific APIs you need (Places API,
  Geocoding API, Directions API, Distance Matrix API)
- **Per-API daily quotas**: set in IAM & Admin → Quotas. Cap each API at e.g.
  5,000 requests/day. Hard stop — Google refuses further requests.
- **Billing alerts**: Billing → Budgets & alerts. Alert at $10, $25, $50, $100.
- **Optional**: separate keys for autocomplete vs directions so you can revoke
  one without breaking the other.

### 2. Supabase database (Movvy's gate)

| Table | Purpose |
|---|---|
| `feature_flags` | Per-service ON/OFF switch. Defaults to OFF. |
| `api_budgets` | Daily + monthly $ cap per service. Hard-stop true. |
| `api_spend_log` | Append-only log of every paid call + cost (USD) |
| `api_cache` | Response cache (1h TTL for autocomplete) |
| `rate_limit_buckets` | Per-user + per-IP sliding window |

Helpers: `api_budget_check(service, est_cost)`, `api_log_call(...)`,
`api_cache_get(key)`, `api_cache_set(...)`.

### 3. Edge Function (Movvy's runtime gate)

Every proxy edge function follows this order:

```
1. requireAuth(req)           — no anonymous spam
2. checkRateLimit per user    — tight (30/min)
3. checkRateLimit per IP      — wider (50/min)
4. api_cache_get              — 1h cache → 0 paid calls
5. api_budget_check           — daily cap enforced
6. feature_flag check         — paid API can be killed instantly
7. Call Google (if all above pass) OR fallback to free Nominatim
8. api_cache_set              — cache for 1h
9. api_log_call               — log cost to api_spend_log
```

Result: under any attack, the worst-case daily spend equals your
`api_budgets.daily_cap_usd`. **Default is $5/day per Google service.**

---

## Killing API spend in an emergency

If something is going wrong and you need to halt all paid calls RIGHT NOW:

### Option A — flip the feature flag (instant, no deploy)

In Supabase SQL Editor:
```sql
update feature_flags set enabled = false where key like 'google_%';
```
Edge functions check this on every request. Next call returns Nominatim
(free) or an error. No restart needed.

### Option B — set daily cap to $0

```sql
update api_budgets set daily_cap_usd = 0 where service like 'google_%';
```
Every subsequent call fails the budget check.

### Option C — disable the key in Google Cloud Console

Cloud Console → Credentials → your key → DISABLE. Takes effect in 30–60 sec.
Use this if a key is suspected leaked — also rotate it.

### Option D — revoke service_role key

Supabase Dashboard → Settings → API → Rotate `service_role` key. This breaks
all edge functions until you update Functions secrets, but stops ALL backend
activity immediately.

---

## Rules for Claude (the AI assistant)

When working on Movvy, Claude:

1. **Never makes calls to paid APIs from its sandbox.** Not for testing, not
   for validation, not to "see if it works." Test against free Nominatim or
   write the code and ask the user to verify on their device.
2. **Never asks the user to paste a Stripe / Google / Twilio key in chat.**
   Always asks them to run `supabase secrets set NAME=value` themselves in
   their own terminal.
3. **Never writes code that calls a paid API in a hot loop** (retry-on-error
   without backoff, polling without cache, etc.).
4. **Never disables a feature flag or raises a budget cap** without the user
   explicitly asking.
5. **Always uses the proxy pattern** for new third-party integrations:
   client → edge function → rate-limited + budget-checked + cached → 3rd party.
6. **Never sets `EXPO_PUBLIC_GOOGLE_*` or similar** — that would inline a paid
   key into the mobile bundle.
7. **Treats `.env.local` as read-only context.** If the user pastes a secret
   in chat, Claude writes it to `.env.local` once and does not echo it back,
   log it, or include it in any committed file.

If Claude is ever asked to do something that would spend money, it stops and
asks for confirmation — naming the service, the per-call cost, and the
estimated total cost of the operation.

---

## When you actually want to spend money

Steps to turn on Google Places autocomplete in production:

1. Create the Google Cloud key with all restrictions above
2. `supabase secrets set GOOGLE_MAPS_SERVER_KEY=AIzaSy...` (in your terminal)
3. Verify the cap: `select * from api_budgets where service = 'google_places';`
   Raise from $5/day to whatever you can absorb in the worst case
4. Flip the flag:
   ```sql
   update feature_flags set enabled = true, updated_at = now()
   where key = 'google_places_enabled';
   ```
5. Watch spend live:
   ```sql
   select service, sum(cost_usd), count(*)
   from api_spend_log
   where created_at >= date_trunc('day', now())
   group by service;
   ```
6. If anything looks off, run the kill-switch query above.

---

**One more time, in plain English: if you're not 100% sure what something
will cost, don't deploy it. Default everything to the free path.**
