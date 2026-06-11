-- =============================================================================
-- Movvy — Migration 0035: record_booking_status_change → SECURITY DEFINER
--
-- The trigger that mirrors every booking status change into
-- booking_status_history (migration 0003) was the only trigger on bookings
-- that didn't run as SECURITY DEFINER. The role-grants migration (0011)
-- only granted INSERT on booking_status_history to service_role — the
-- authenticated role has none — so when an authenticated customer inserted
-- a row into `bookings` the AFTER trigger failed with
--
--   permission denied for table booking_status_history (SQLSTATE 42501)
--
-- which surfaced to the customer as "Could not create booking" from the
-- bookings-create edge function.
--
-- Fix: redefine the trigger function as SECURITY DEFINER so the audit row
-- is written with the trigger-owner's privileges, matching every other
-- bookings-trigger in the schema (lock_booking_after_assignment,
-- enforce_booking_status_transition, notify_customer_on_status_change,
-- queue_driver_payout, notify_booking_status_change). Setting search_path
-- explicitly is the standard hardening for SECURITY DEFINER functions.
-- =============================================================================

create or replace function record_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    insert into booking_status_history (booking_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif (new.status is distinct from old.status) then
    insert into booking_status_history (booking_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
