-- =============================================================================
-- Movvy — Migration 0069
--
-- Two unrelated additive changes bundled:
--
-- 1. E-TRANSFER PAYOUT EMAIL (companies.etransfer_email)
--    Adam pays crews/companies via Interac e-Transfer as well as bank wire, so
--    the payout profile needs an email address alongside the bank fields. Pure
--    additive column — no constraint beyond a light email shape check.
--
-- 2. PAST-DATE JOB EXPIRY
--    A booking that stays `searching` (no company accepted it) past its move
--    date should stop showing up as an open job. We flip those to `cancelled`
--    hourly via pg_cron so they drop out of dispatch_queue / org_open_jobs
--    (both of which only surface `searching` rows) and out of the customer's
--    upcoming list. NOTE: this does NOT refund the deposit — a job no one took
--    likely warrants a deposit refund, but that needs a Stripe call and is
--    intentionally left as a follow-up (flagged to Adam).
-- =============================================================================

-- 1. E-transfer email ---------------------------------------------------------
alter table companies
  add column if not exists etransfer_email text;

alter table companies
  drop constraint if exists companies_etransfer_email_format;
alter table companies
  add constraint companies_etransfer_email_format check (
    etransfer_email is null
    or etransfer_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  );

-- 2. Past-date job expiry -----------------------------------------------------
create or replace function expire_stale_searching_bookings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with expired as (
    update bookings
       set status = 'cancelled',
           cancelled_at = now(),
           cancellation_reason = 'Expired — no company accepted before the move date'
     where status = 'searching'
       and scheduled_for_date < current_date
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

revoke all on function expire_stale_searching_bookings() from public;
grant execute on function expire_stale_searching_bookings() to service_role;

-- Schedule hourly (guarded — pg_cron only exists on the hosted project).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('movvy-expire-stale-searching')
      where exists (select 1 from cron.job where jobname = 'movvy-expire-stale-searching');
    perform cron.schedule(
      'movvy-expire-stale-searching',
      '17 * * * *',
      $cron$ select expire_stale_searching_bookings(); $cron$
    );
  end if;
end;
$$;
