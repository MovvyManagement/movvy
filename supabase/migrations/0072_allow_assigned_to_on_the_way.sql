-- =============================================================================
-- 0072 — Let an assigned crew start the move directly (assigned → on_the_way).
--
-- Bug: pressing "We've left HQ" on the crew Active screen failed with
-- "Could not update — Edge Function returned a non-2xx status code". The step
-- machine goes assigned/confirmed → on_the_way, but bookings-dispatch-assign
-- leaves the booking at status='assigned' (it only sets the driver), and
-- enforce_booking_status_transition() only permitted assigned → confirmed/
-- cancelled. So the very first status update every crew makes was rejected.
--
-- Fix: permit assigned → on_the_way. The 'confirmed' step stays valid but
-- optional — for a dispatched/self-assigned move the assignment IS the
-- commitment, so the crew can roll straight from HQ. (Also keeps the earlier
-- assigned → searching release path from 0070.)
-- =============================================================================

create or replace function enforce_booking_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if old.status = new.status then
    return new;
  end if;

  v_allowed := case
    when old.status = 'draft'      and new.status in ('pending', 'searching', 'cancelled') then true
    when old.status = 'pending'    and new.status in ('searching', 'cancelled', 'failed') then true
    when old.status = 'searching'  and new.status in ('assigned', 'cancelled', 'failed') then true
    -- assigned can: confirm, release back to the pool (0070), start the move,
    -- or cancel.
    when old.status = 'assigned'   and new.status in ('confirmed', 'searching', 'on_the_way', 'cancelled') then true
    when old.status = 'confirmed'  and new.status in ('on_the_way', 'cancelled') then true
    when old.status = 'on_the_way' and new.status in ('arrived', 'cancelled') then true
    when old.status = 'arrived'    and new.status in ('loading', 'cancelled') then true
    when old.status = 'loading'    and new.status in ('in_transit', 'cancelled') then true
    when old.status = 'in_transit' and new.status in ('unloading', 'cancelled') then true
    when old.status = 'unloading'  and new.status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_allowed then
    raise exception 'Invalid booking status transition: % → %', old.status, new.status
      using errcode = '22023';
  end if;

  return new;
end $$;
