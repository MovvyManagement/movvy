# Email trigger setup (manual dashboard steps)

This walks through the 3 manual configuration steps needed to wire the
last 3 email templates into real business events. Everything else
(`bookingConfirmed`, `bookingCancelled`, `moveComplete`, `accountDeleted`,
`moverApproved`, `moverApplicationDeclined`) is fully automatic — those
templates fire from edge functions that are already deployed.

The 3 manual steps:
1. Database Webhook → `customer-welcome-on-signup` (fires `welcomeCustomer`)
2. Database Webhook → `partner-welcome-on-signup` (fires `moverApplicationReceived`)
3. pg_cron schedule → `cron-weekly-payouts` (fires `weeklyPayoutSummary` every Fri)

⚠️ **Secrets in this doc are real values.** Don't commit them anywhere
public, paste them in chats, or share screenshots of this file. They're
here because the dashboard needs them and rotating them is trivial
(`supabase secrets set DB_WEBHOOK_SECRET=$(openssl rand -hex 24)`).

---

## 1. customer-welcome-on-signup webhook

**What it does:** fires the `welcomeCustomer` email every time a new
`profiles` row lands with `role = 'customer'`. Catches every signup
path automatically.

**Setup:**

1. Go to **Supabase Dashboard → Database → Webhooks → Create a new hook**
2. Fill in:
   - **Name:** `customer-welcome`
   - **Table:** `public.profiles`
   - **Events:** ✅ INSERT only (uncheck UPDATE + DELETE)
   - **Type:** Supabase Edge Functions
   - **Edge Function:** `customer-welcome-on-signup`
   - **HTTP method:** POST
   - **HTTP params:** (leave empty)
   - **HTTP headers:**
     ```
     Content-Type: application/json
     x-webhook-secret: 1bb08c2a4b990e50906d807659196492bedc7396a5f15593
     ```
3. Click **Create webhook**

**Verify:** sign up a brand new customer in the mobile app with a test
email. Within ~5 seconds the welcome email should land in their inbox.
The `email_events` table will log a `sent` row + a `delivered` row.

---

## 2. partner-welcome-on-signup webhook

**What it does:** fires the `moverApplicationReceived` email every time
a new `partner_teams` row lands (someone signs up as a mover).

**Setup:**

1. Go to **Supabase Dashboard → Database → Webhooks → Create a new hook**
2. Fill in:
   - **Name:** `partner-welcome`
   - **Table:** `public.partner_teams`
   - **Events:** ✅ INSERT only
   - **Type:** Supabase Edge Functions
   - **Edge Function:** `partner-welcome-on-signup`
   - **HTTP method:** POST
   - **HTTP params:** (leave empty)
   - **HTTP headers:**
     ```
     Content-Type: application/json
     x-webhook-secret: 1bb08c2a4b990e50906d807659196492bedc7396a5f15593
     ```
3. Click **Create webhook**

**Verify:** sign up a brand new mover/team in the mobile app. The
"application received" email should land in their inbox.

---

## 3. cron-weekly-payouts schedule

**What it does:** every Friday at 16:00 UTC (= 9 AM MDT / 10 AM MST),
aggregates last week's completed bookings per driver and sends the
`weeklyPayoutSummary` email to each one.

**Prerequisite:** make sure pg_cron + pg_net are enabled on the
Supabase project (Dashboard → Database → Extensions → search "cron"
and "net" → enable both).

**Setup — paste this whole block into the Supabase SQL Editor and run
it once:**

```sql
-- Allow pg_cron to call our edge functions over HTTPS
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any earlier definition so re-running this block is idempotent
select cron.unschedule('weekly-payout-summary')
where exists (select 1 from cron.job where jobname = 'weekly-payout-summary');

-- Every Friday at 16:00 UTC = 9:00 AM Mountain Time (MDT) / 10 AM (MST)
select cron.schedule(
  'weekly-payout-summary',
  '0 16 * * 5',
  $$
    select net.http_post(
      url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/cron-weekly-payouts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'b02ef5b9d0b876ab78c352a06062042c0ce34a87af743085'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

**Verify the schedule is registered:**
```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'weekly-payout-summary';
```

**Test the function manually (any time, doesn't wait for Friday):**
```bash
curl -X POST \
  https://aabenjobueqawtyebirt.supabase.co/functions/v1/cron-weekly-payouts \
  -H 'Content-Type: application/json' \
  -H 'x-cron-secret: b02ef5b9d0b876ab78c352a06062042c0ce34a87af743085' \
  -d '{}'
```
Response is JSON with `{ sent, failed, weekRangeLabel, results }`.

---

## Rotating these secrets

If either secret leaks:

```bash
# Generate + set new values
supabase secrets set \
  DB_WEBHOOK_SECRET=$(openssl rand -hex 24) \
  CRON_SECRET=$(openssl rand -hex 24)

# Then update the webhook headers + cron SQL above to match
```
