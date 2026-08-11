# Movvy demo credentials

**These are the accounts that actually exist in the live project**, verified by
signing in with each one. One password for all four:

```
MovvyDemo2026!
```

> **Why this file was rewritten (2026-08-11).** It used to document four
> `*-demo@movvy.app` accounts created by `scripts/seed-demo.mjs`. Only one of
> those was ever in the live database, and that script refuses to run against
> production by design — so the documented logins didn't work and the working
> logins weren't documented. The set below is the real one, and it matches the
> merged crew model (`companies` + `company_members`), not the retired
> `partner_teams` model the old seed built.

---

## The four accounts

| Email | Name | Signs in as | Org |
|---|---|---|---|
| `demo.customer@movvy.ca` | Demo Customer | Customer | — |
| `demo.driver@movvy.ca` | Dan Driver | **Crew admin** | Adam Crew |
| `demo.crew1@movvy.ca` | Chris Crew | Crew member | Adam Crew |
| `demo.crew2@movvy.ca` | Casey Crew | Crew member | Adam Crew |

Invite code for **Adam Crew**: `CO-R5AMHB`
(Movvy's own org, `Movvy Management`, is `CO-TX5AJX` — that's `management@movvy.ca`,
the real owner account. Don't use it for demos.)

**Where to sign in**

- Customer → Welcome → *"I already have an account"*
- Crew admin and crew members → Welcome → *"Already a partner? Partner sign-in"*

---

## What each account is for

### `demo.customer@movvy.ca` — the customer side
Book a move, watch the live tracker, chat with the crew, download a receipt PDF,
rate the crew afterwards. Also the account to use for the **modify** flow: change
a booked address and confirm the estimate re-prices and the crew gets notified.

### `demo.driver@movvy.ca` — the crew ADMIN
The only account that can **accept** a job from the open pool, and the only one
that can **assign** it to a crew member. Also the only one that sees the payout
balance and can request a payout (Mondays only). Bank details live on this
account's profile — they write to `companies`, which is the table the payouts
console reads.

### `demo.crew1@movvy.ca` / `demo.crew2@movvy.ca` — crew MEMBERS
Deliberately limited, and that's the product rule, not a bug:

- **No open job feed.** They see only what the admin assigned them, under "My Jobs".
- **Cannot accept jobs.** The server refuses, with a message telling them their
  admin has to take it first.
- **No payout balance.** The card says their crew admin handles payouts.
- They *can* flag stops on an assigned move (left HQ → arrived → … → complete),
  including correcting a missed tap with the time picker.

Use `demo.crew2` as the second person on a two-person crew to check the
passenger view — they should see the move their colleague is driving.

---

## Test addresses

Address autocomplete uses real geocoding, so any Alberta address works. Useful pairs:

| Pickup | Drop-off | What it exercises |
|---|---|---|
| 425 1 Ave NE, Calgary | 2020 Memorial Dr NW, Calgary | Intra-Calgary residential (~6 km) — the typical move |
| 600 Centre St N, Calgary | 333 96 Ave NE, Calgary | Same neighbourhood → the 4-hour minimum |
| 5500 Macleod Trail SW, Calgary | 425 1 Ave NE, Calgary | Across town — higher travel hours |
| 100 Stephen Ave SW, Calgary | 10180 101 St NW, Edmonton | **Long haul** — per-km transit + the amber banner |

The Calgary → Edmonton pair is the one that exercises the long-haul engine, the
GPS transit measurement and its coverage test. Use it to check the surcharge math.

---

## Housekeeping

There is one orphan left from the old seed: **`customer-demo@movvy.app`**
("Casey Customer"). It has no org and duplicates `demo.customer@movvy.ca`. Safe
to delete; left in place only because deleting real auth rows isn't something to
do casually.

`scripts/seed-demo.mjs` still builds the OLD `partner_teams` model and refuses to
run against production. Don't run it expecting these accounts — it would create a
parallel set that the app can't use.

---

## ⚠️ Before going live

1. Delete every `demo.*@movvy.ca` and `customer-demo@movvy.app` user
2. Rotate or delete the `Adam Crew` org and its invite code `CO-R5AMHB`
3. Remove this file from the repo and `.gitignore` it
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` is never bundled into the client

Keep `management@movvy.ca` — that's the real owner account.
