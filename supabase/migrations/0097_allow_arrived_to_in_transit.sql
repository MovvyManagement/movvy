-- =============================================================================
-- 0097 — Let a crew go straight from `arrived` to `in_transit`.
--
-- Confirmed by running a real booking through the live endpoints: the Active
-- screen's "Loaded · heading to drop-off" button declares
-- fromStatus ['arrived','loading'] → in_transit, so from `arrived` it asks for
-- exactly that jump — and the database refused it:
--
--     Invalid booking status transition: arrived → in_transit
--
-- It appeared to work only because doAdvance() fires a SECOND, unawaited
-- transition 600 ms later:
--
--     setTimeout(() => update.mutate({ new_status: 'loading' }), 600)
--
-- When that follow-up lands, the sequence is legal. When it doesn't — offline,
-- screen unmounted, app backgrounded, request dropped — the booking sits at
-- `arrived` and the only button the UI offers keeps asking for an illegal
-- transition. The crew is stuck mid-move with an error they cannot clear, and
-- the move can never reach unloading or completion.
--
-- Two ways to fix it. Making the UI await a two-step sequence keeps the strict
-- ladder but leaves the same failure if the second call fails. Allowing the skip
-- removes the dependency entirely: `loading` is a nice-to-have breadcrumb, not a
-- billing boundary — the meter runs from "left HQ" to "finish" and long-haul
-- transit is bracketed by in_transit/unloading, neither of which needs `loading`.
--
-- So: allow it, and drop the setTimeout on the client (it would otherwise race
-- and try in_transit → loading, which is illegal in the other direction).
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
      when old.status = 'confirmed'  and new.status in ('on_the_way', 'cancelled') then true
      when old.status = 'on_the_way' and new.status in ('arrived', 'cancelled') then true
      -- `loading` is now optional: a crew that presses "Loaded · heading to
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
