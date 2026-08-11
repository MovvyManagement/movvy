-- =============================================================================
-- Migration 0108 — a confirmed move can be handed to another crew
--
-- Reassignment works by putting the booking back to 'assigned' with a new crew
-- on it. The transition table allowed that from 'searching' but not from
-- 'confirmed', so admin-reassign-booking's write was rejected by this trigger
-- with errcode 22023 — which the endpoint reports as "This move just changed
-- status — reload and try again." That message is never true and reloading
-- never helps, so the operator retries forever.
--
-- The real-world shape of it: a crew confirms a move, their truck breaks down
-- the night before, and there is no way to give the job to anyone else. The
-- only path was cancel-and-rebook, which loses the customer's deposit history
-- and their slot.
--
-- Also adds 'searching' from 'confirmed', so a confirmed move can be released
-- back to the open pool the same way an assigned one already can (0070). Same
-- justification: the alternative is a no-show.
--
-- Everything else is carried forward verbatim from 0097. This function is
-- redefined wholesale on every change, so the full table has to be restated —
-- dropping a line here silently forbids a transition the app still offers.
-- =============================================================================

create or replace function enforce_booking_status_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;

  if not (
    case
      when old.status = 'draft'      and new.status in ('pending', 'searching', 'cancelled') then true
      when old.status = 'pending'    and new.status in ('searching', 'cancelled', 'failed') then true
      when old.status = 'searching'  and new.status in ('assigned', 'cancelled', 'failed') then true
      -- A dispatcher can hand a staffed move back to the pool (0070).
      when old.status = 'assigned'   and new.status in ('confirmed', 'on_the_way', 'searching', 'cancelled') then true
      -- Reassignment and release from 'confirmed' (0108). Nobody has driven
      -- anywhere yet, so swapping the crew costs the customer nothing — and
      -- refusing it cost them the whole move.
      when old.status = 'confirmed'  and new.status in ('assigned', 'searching', 'on_the_way', 'cancelled') then true
      when old.status = 'on_the_way' and new.status in ('arrived', 'cancelled') then true
      -- `loading` is optional: a crew that presses "Loaded · heading to
      -- drop-off" straight from `arrived` must not be stranded (0097).
      when old.status = 'arrived'    and new.status in ('loading', 'in_transit', 'cancelled') then true
      when old.status = 'loading'    and new.status in ('in_transit', 'cancelled') then true
      when old.status = 'in_transit' and new.status in ('unloading', 'cancelled') then true
      when old.status = 'unloading'  and new.status in ('completed', 'cancelled') then true
      else false
    end
  ) then
    raise exception 'Invalid booking status transition: % → %', old.status, new.status
      using errcode = '22023';
  end if;

  return new;
end $$;

-- NOTE: this does NOT re-open reassignment after the crew leaves HQ. That gate
-- lives in admin-reassign-booking (on_the_way onward is refused outright), and
-- deliberately so — 'confirmed' → 'assigned' being legal at the database level
-- is about what the schema permits, not about the product rule.

notify pgrst, 'reload schema';
