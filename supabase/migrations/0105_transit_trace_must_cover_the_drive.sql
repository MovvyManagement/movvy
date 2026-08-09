-- =============================================================================
-- Migration 0105 — a GPS trace only counts if it actually covers the drive
--
-- measured_transit_km accepted ANY trace with three or more pings. Three pings
-- can span two minutes of a four-hour drive, and a chord sum is always shorter
-- than the road, so a partially-captured drive still qualified as "usable" and
-- dragged the billed distance down to the clamp floor.
--
-- Worked example: Calgary → Fort McMurray, quoted 730 km = $2,920 of transit.
-- Background location gets killed mid-route and only the two ends are recorded.
-- The chord sum comes out around 520 km, the old 0.8 floor clamps it to 584 km,
-- and the customer is billed $2,336 — $584 + GST under the true figure, with
-- about $490 of that coming out of the crew's pay. Nothing in the old function
-- could tell that apart from a genuinely shorter route.
--
-- Founder decision: do both available fixes.
--
--   1. Coverage test — the trace must actually span the transit window:
--        • first ping within COVERAGE_EDGE of p_from
--        • last ping within COVERAGE_EDGE of p_to
--        • no gap longer than MAX_GAP between consecutive pings
--      Failing any of these returns NULL, and the caller falls back to the
--      QUOTED distance rather than the floor. That's the important part: a
--      broken trace should mean "we don't know, use the quote", not "assume
--      the shortest number we're allowed to bill".
--
--   2. The floor rises from 0.8 to 0.95 in the caller, so even a trace that
--      passes coverage but still under-measures can only move the bill by 5%.
--
-- Thresholds are set against the real ping cadence: bgTracking uses
-- distanceInterval 500 m / timeInterval 20 s, so a healthy trace has pings far
-- closer together than these bounds. A 10-minute hole at highway speed is ~15
-- unrecorded kilometres, which is more than the 5% the floor now allows — so
-- anything that could still distort the bill is caught by the gap test.
-- =============================================================================

create or replace function measured_transit_km(
  p_booking_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  -- How close to each end of the window the trace must reach.
  c_coverage_edge interval := interval '5 minutes';
  -- Longest silence tolerated inside the window.
  c_max_gap       interval := interval '10 minutes';
  v_n int;
  v_first timestamptz;
  v_last timestamptz;
  v_max_gap interval;
  v_km numeric;
begin
  with pings as (
    select lat, lng, recorded_at,
           lag(lat)         over (order by recorded_at) as prev_lat,
           lag(lng)         over (order by recorded_at) as prev_lng,
           lag(recorded_at) over (order by recorded_at) as prev_at
      from booking_tracking
     where booking_id = p_booking_id
       and recorded_at >= p_from
       and recorded_at <= p_to
  )
  select count(*),
         min(recorded_at),
         max(recorded_at),
         max(recorded_at - prev_at),
         round(sum(
           case when prev_lat is not null
                then movvy_km_between(prev_lat, prev_lng, lat, lng)
                else 0 end
         )::numeric, 1)
    into v_n, v_first, v_last, v_max_gap, v_km
    from pings;

  -- Not enough to say anything at all.
  if coalesce(v_n, 0) < 3 or v_km is null or v_km <= 0 then
    return null;
  end if;

  -- Did the trace actually start when the drive started, and end when it ended?
  if v_first > p_from + c_coverage_edge then return null; end if;
  if v_last  < p_to   - c_coverage_edge then return null; end if;

  -- Any long silence means we measured only part of the route.
  if v_max_gap is not null and v_max_gap > c_max_gap then return null; end if;

  return v_km;
end $$;

grant execute on function measured_transit_km(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function measured_transit_km(uuid, timestamptz, timestamptz) is
  'Road distance summed from GPS pings inside the transit window. Returns NULL unless the trace COVERS that window (starts within 5 min of the start, ends within 5 min of the end, no gap over 10 min) — a partial trace must fall back to the quote, not to the clamp floor (0105).';

notify pgrst, 'reload schema';
