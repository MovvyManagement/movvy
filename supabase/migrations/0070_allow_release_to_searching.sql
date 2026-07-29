-- =============================================================================
-- 0070 — Allow a company to RELEASE an accepted-but-unstaffed job back to the
--        open pool (assigned → searching).
--
-- Bug: the Release button on (company)/jobs.tsx failed with "Could not release —
-- Edge Function returned a non-2xx status code". The dispatch-decline function
-- pushes the booking assigned → searching, but enforce_booking_status_transition()
-- (migration 0061) only permitted assigned → confirmed/cancelled. The trigger
-- raised, the update errored, and the function returned a non-2xx.
--
-- Fix: permit assigned → searching. This is exactly the release path — a company
-- that accepted a job but can't staff it hands it back so other orgs can pick it
-- up. The dispatch-decline function already guards this (owner/dispatcher only,
-- and only while no driver is assigned), so opening the transition is safe.
-- =============================================================================

create or replace function enforce_booking_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Admins can override
  if is_admin() then
    return new;
  end if;

  if old.status = new.status then
    return new;
  end if;

  v_allowed := case
    -- draft → searching is the deposit-paid dispatch (stripe-webhook).
    when old.status = 'draft'      and new.status in ('pending', 'searching', 'cancelled') then true
    when old.status = 'pending'    and new.status in ('searching', 'cancelled', 'failed') then true
    when old.status = 'searching'  and new.status in ('assigned', 'cancelled', 'failed') then true
    -- assigned → searching is the RELEASE path: a company hands an accepted but
    -- unstaffed job back to the open pool for others to claim.
    when old.status = 'assigned'   and new.status in ('confirmed', 'searching', 'cancelled') then true
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
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  return new;
end $$;
