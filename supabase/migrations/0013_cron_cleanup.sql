-- =============================================================================
-- Movvy — Migration 0013: Hygiene jobs (pg_cron) + small helper RPCs
--
-- Schedules nightly cleanup so high-write tables don't grow unbounded.
-- All cleanup runs in the postgres role via pg_cron; bypasses RLS.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Prune expired API cache rows (kept 1 day past TTL for debugging)
-- -----------------------------------------------------------------------------
create or replace function job_prune_api_cache()
returns int language sql security definer set search_path = public, pg_temp as $$
  with deleted as (
    delete from api_cache where expires_at < now() - interval '1 day' returning 1
  ) select count(*)::int from deleted;
$$;

-- -----------------------------------------------------------------------------
-- 2. Prune old tracking pings (kept 30 days for support / dispute review)
-- -----------------------------------------------------------------------------
create or replace function job_prune_tracking_pings()
returns int language sql security definer set search_path = public, pg_temp as $$
  with deleted as (
    delete from booking_tracking where recorded_at < now() - interval '30 days' returning 1
  ) select count(*)::int from deleted;
$$;

-- -----------------------------------------------------------------------------
-- 3. Prune stale rate-limit buckets (anything whose window ended >1 day ago)
-- -----------------------------------------------------------------------------
create or replace function job_prune_rate_limits()
returns int language sql security definer set search_path = public, pg_temp as $$
  with deleted as (
    delete from rate_limit_buckets where window_ends_at < now() - interval '1 day' returning 1
  ) select count(*)::int from deleted;
$$;

-- -----------------------------------------------------------------------------
-- 4. Expire phone proxy sessions past their expires_at
-- -----------------------------------------------------------------------------
create or replace function job_expire_proxy_sessions()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  with expired as (
    update phone_proxy_sessions
    set status = 'expired'
    where status in ('pending','active') and expires_at < now()
    returning id
  )
  select count(*) into v_count from expired;

  -- Release the numbers back to the pool
  update twilio_number_pool
    set active_session_id = null
    where active_session_id in (
      select id from phone_proxy_sessions where status = 'expired'
    );

  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Prune resolved audit_logs older than 1 year (compliance retention)
-- -----------------------------------------------------------------------------
create or replace function job_prune_audit_logs()
returns int language sql security definer set search_path = public, pg_temp as $$
  with deleted as (
    delete from audit_logs where created_at < now() - interval '1 year' returning 1
  ) select count(*)::int from deleted;
$$;

-- -----------------------------------------------------------------------------
-- Schedule with pg_cron — all run at low-traffic 04:00 UTC
-- -----------------------------------------------------------------------------

select cron.schedule(
  'movvy-prune-api-cache',
  '15 4 * * *',
  $$ select public.job_prune_api_cache(); $$
);

select cron.schedule(
  'movvy-prune-tracking-pings',
  '20 4 * * *',
  $$ select public.job_prune_tracking_pings(); $$
);

select cron.schedule(
  'movvy-prune-rate-limits',
  '25 4 * * *',
  $$ select public.job_prune_rate_limits(); $$
);

select cron.schedule(
  'movvy-expire-proxy-sessions',
  '*/5 * * * *',   -- every 5 min so numbers recycle quickly
  $$ select public.job_expire_proxy_sessions(); $$
);

select cron.schedule(
  'movvy-prune-audit-logs',
  '30 4 1 * *',   -- monthly, 1st of the month
  $$ select public.job_prune_audit_logs(); $$
);

-- -----------------------------------------------------------------------------
-- Promo counter helper RPC (used by bookings-create when applying a promo)
-- -----------------------------------------------------------------------------

create or replace function increment_promo_redeemed(p_promo_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update promo_codes set redeemed_count = redeemed_count + 1 where id = p_promo_id;
$$;

grant execute on function increment_promo_redeemed(uuid) to authenticated, service_role;
