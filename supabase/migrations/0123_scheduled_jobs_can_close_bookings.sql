-- =============================================================================
-- Migration 0123 — let the database's own scheduled jobs close bookings
--
-- Two hourly pg_cron jobs tidy up bookings:
--   • movvy-expire-stale-searching  cancels jobs nobody accepted before the
--                                    move date (0069)
--   • cancel-stale-draft-bookings   cancels checkouts abandoned before the
--                                    deposit was paid (0062)
--
-- Both set cancelled_at and cancellation_reason as well as status. The column
-- lock from 0101 only trusted admins and the service-role API, and pg_cron
-- runs jobs directly in the database as `postgres`, with no API token. So
-- every run that found something to cancel failed with "Bookings are
-- server-owned". Past-date jobs stayed open in crews' Requests list for weeks
-- (MV-1060, MV-1061).
--
-- Fix: also trust a direct connection made as `postgres`. That is the
-- database owner: it can already disable this trigger outright, so trusting
-- it gives nobody anything new. App users never connect as it: PostgREST
-- connects as `authenticator` and switches to anon / authenticated /
-- service_role. session_user is used, not current_user, because inside this
-- SECURITY DEFINER function current_user is always the function's owner.
-- =============================================================================

create or replace function lock_booking_after_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- The ONLY columns a non-admin, non-service caller may alter. Everything
  -- else — rates, hours, timestamps, tips, transit, assignment, payment — is
  -- server-owned. Adding a column to bookings automatically protects it.
  v_allowed text[] := array['status', 'updated_at'];
  v_old jsonb;
  v_new jsonb;
begin
  if is_admin() or is_service_role() then return new; end if;
  -- The database's own scheduled jobs (pg_cron) and owner sessions. See above.
  if session_user = 'postgres' then return new; end if;

  v_old := to_jsonb(old) - v_allowed;
  v_new := to_jsonb(new) - v_allowed;

  if v_old <> v_new then
    raise exception
      'Bookings are server-owned: use the Movvy API to change anything but status'
      using errcode = '22023';
  end if;

  return new;
end $$;
