-- =============================================================================
-- 0090 — Measure the distance the truck ACTUALLY drove between the addresses.
--
-- The final bill should reflect the move that happened, not the move we
-- predicted. Hours already work that way. Distance didn't: a long haul billed
-- the quoted kilometres no matter what route the truck took.
--
-- booking_tracking already stores a GPS ping every time the driver's phone
-- reports in, so the driven distance is just the sum of the hops between
-- consecutive pings inside the transit window.
--
-- Two things this deliberately does NOT do:
--
--   • It doesn't let the bill run away. The caller clamps the result to a band
--     around the quote (see bookings-update-status). A driver who detours, or
--     a phone that wakes up mid-route and reports a straight line across the
--     province, must not be able to move the customer's price.
--   • It doesn't punish a GPS gap. Pings drop out — tunnels, dead battery,
--     the OS throttling background updates. A sparse trace under-measures, and
--     the band's lower bound is what stops that from gutting the crew's pay.
--
-- Returns NULL when there aren't enough pings to say anything, which the
-- caller reads as "use the quote".
-- =============================================================================

create or replace function measured_transit_km(
  p_booking_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  with pings as (
    select lat, lng, recorded_at,
           lag(lat) over (order by recorded_at) as prev_lat,
           lag(lng) over (order by recorded_at) as prev_lng
    from booking_tracking
    where booking_id = p_booking_id
      and recorded_at >= p_from
      and recorded_at <= p_to
  ),
  hops as (
    select movvy_km_between(prev_lat, prev_lng, lat, lng) as km
    from pings
    where prev_lat is not null
  )
  -- Three hops is the floor for calling a trace usable at all.
  select case when count(*) >= 3 then round(sum(km)::numeric, 1) end
  from hops;
$$;

grant execute on function measured_transit_km(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

-- What the invoice ended up charging for distance, so an admin can see when the
-- measured route differed from the quote and why the number moved.
alter table bookings
  add column if not exists actual_transit_km numeric(8,1),
  add column if not exists actual_transit_cents int;

comment on column bookings.actual_transit_km is
  'Driven distance between the addresses, measured from GPS and clamped to a band around the quote. Null on local moves and when the trace was too sparse to use.';
comment on column bookings.actual_transit_cents is
  'The transit charge that actually went on the invoice.';
