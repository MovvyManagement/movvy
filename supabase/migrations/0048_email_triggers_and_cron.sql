-- =============================================================================
-- Email triggers + weekly payout cron
--
-- Replaces the dashboard-managed Database Webhooks with raw Postgres triggers
-- because the dashboard UI errors out with `schema "supabase_functions" does
-- not exist` on this project (newer-project Supabase init quirk).
--
-- Net result is identical: an INSERT on profiles (role=customer) or
-- partner_teams fires a POST to the matching edge function. The trigger is
-- gated by a shared secret so the edge function can verify the call came
-- from our DB, not a random caller.
--
-- The pg_cron schedule for weeklyPayoutSummary lives at the bottom so all
-- the email plumbing is in one place.
-- =============================================================================

-- Required extensions
create extension if not exists pg_net schema extensions;
create extension if not exists pg_cron;

-- ─── Customer welcome trigger ────────────────────────────────────────────────
-- Fires welcomeCustomer email when a new profile row lands with role='customer'.

create or replace function notify_customer_welcome()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role = 'customer' and new.email is not null then
    perform net.http_post(
      url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/customer-welcome-on-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', '1bb08c2a4b990e50906d807659196492bedc7396a5f15593'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'profiles',
        'record', row_to_json(new)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_customer_welcome on public.profiles;
create trigger profiles_customer_welcome
  after insert on public.profiles
  for each row
  execute function notify_customer_welcome();

-- ─── Partner welcome trigger ─────────────────────────────────────────────────
-- Fires moverApplicationReceived when a new partner_teams row lands.

create or replace function notify_partner_welcome()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/partner-welcome-on-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '1bb08c2a4b990e50906d807659196492bedc7396a5f15593'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'partner_teams',
      'record', row_to_json(new)
    )
  );
  return new;
end;
$$;

drop trigger if exists partner_teams_welcome on public.partner_teams;
create trigger partner_teams_welcome
  after insert on public.partner_teams
  for each row
  execute function notify_partner_welcome();

-- ─── Weekly payout summary cron ──────────────────────────────────────────────
-- Fridays at 16:00 UTC = 9:00 AM Mountain Time (MDT) / 10:00 AM (MST).
-- Idempotent: unschedules any prior definition before re-scheduling.

select cron.unschedule('weekly-payout-summary')
where exists (select 1 from cron.job where jobname = 'weekly-payout-summary');

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
