# Movvy demo credentials

Use these to walk through every surface end-to-end. **One password for all four
accounts:**

```
MovvyDemo2026!
```

Run the seed first to create them:

```bash
npm install @supabase/supabase-js
node scripts/seed-demo.mjs
```

The script prints the generated team / company invite codes at the end. Paste
those into the partner sign-in screen alongside the email + password below.

---

## 👤 Customer — book + track + chat + rate

| Field | Value |
|---|---|
| Email | `customer-demo@movvy.app` |
| Password | `MovvyDemo2026!` |
| Sign-in entry | Welcome → **"I already have an account"** |

**What you'll see:**
- Home with the booking widget + active-move badge
- Notification inbox (bell tap)
- A `searching` booking is pre-seeded so the Moves tab has something on it
- Review-prompt modal fires the moment a driver completes the move

---

## 🚛 Driver — solo 2-person team ("Demo Crew")

| Field | Value |
|---|---|
| Email | `driver-demo@movvy.app` |
| Password | `MovvyDemo2026!` |
| Team invite code | **`TM-XXXXXX`** *(printed by seed script — copy from terminal)* |
| Sign-in entry | Welcome → **"Already a partner? Partner sign-in"** |

**What you'll see:**
- Jobs tab (briefcase icon) — open feed + accept button
- Active tab — flag stops (left HQ → arrived → completed)
- Earnings tab — cold-state copy until first move
- Profile — your driver stats, availability calendar, refer-a-driver

---

## 🏋️ Mover — passenger view on the same team

| Field | Value |
|---|---|
| Email | `mover-demo@movvy.app` |
| Password | `MovvyDemo2026!` |
| Team invite code | **`TM-XXXXXX`** *(same code as the driver)* |
| Sign-in entry | Welcome → **"Already a partner? Partner sign-in"** |

**What you'll see:**
- Read-only mirror of whatever Diego (the driver) is doing
- Chat with the customer still works
- No accept / decline / flag buttons (the driver owns those)

---

## 🏢 Company owner — "Demo Movers Co." dispatch fleet

| Field | Value |
|---|---|
| Email | `company-demo@movvy.app` |
| Password | `MovvyDemo2026!` |
| Company invite code | **`CO-XXXXXX`** *(printed by seed script — copy from terminal)* |
| Sign-in entry | Welcome → **"Already a partner? Partner sign-in"** |

**What you'll see:**
- Dashboard with live utilization + today's revenue
- **Dispatch** — accept incoming requests, assign drivers, decline
- Jobs — Inbox / Assigned / Completed buckets
- Earnings (mocked; will populate after real moves complete)
- Company tab — driver roster (live), brand info, support

---

## 📍 Test addresses for the booking flow

The address autocomplete uses real geocoding (Nominatim → Google when wired)
so any real Alberta address works. Quick copy-pastes:

| Pickup | Drop-off | What it exercises |
|---|---|---|
| 425 1 Ave NE, Calgary | 2020 Memorial Dr NW, Calgary | Intra-Calgary residential (~6 km) — typical move |
| 1234 Kensington Rd NW, Calgary | 999 8 St SW, Calgary | Short cross-river run — quick demo |
| 5500 Macleod Trail SW, Calgary | 425 1 Ave NE, Calgary | Across-town — exercises higher travel hours |
| 600 Centre St N, Calgary | 333 96 Ave NE, Calgary | Same neighborhood → minimum 4-hr billing rule |
| 100 Stephen Ave SW, Calgary | 10180 101 St NW, Edmonton | **Cross-city** — triggers long-haul surcharge banner |

The "cross-city" pair (Calgary → Edmonton) is the only one that exercises the
new long-haul pricing engine + the amber "Long-distance move" banner on the
confirm screen. Use it to validate the surcharge math.

---

## 🔁 Re-running the seed

The script is **idempotent** — running it twice is safe. It checks for
existing accounts/teams/companies and skips re-creation. If you want a
clean slate, delete the rows from Supabase Studio first:

```sql
delete from auth.users where email like '%@movvy.app' and email like '%-demo%';
-- profiles, partner_team_members, company_members cascade automatically
```

Then re-run the script.

---

## ⚠️ Production note

These are **demo accounts** with intentionally weak credentials. Before going
live:

1. Delete every `*-demo@movvy.app` user from `auth.users`
2. Rotate the team + company invite codes (or delete those entities entirely)
3. Remove `scripts/DEMO_CREDENTIALS.md` from the repo and `.gitignore` it
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` is never bundled in the client
