-- =============================================================================
-- Migration 0044 — Backfill bookings.distance_km + duration_min
--
-- Until now bookings-create never set these two columns, so every existing
-- row shows "0.0 km · 0 min" on the mover's job-details screen even though
-- the pickup + dropoff coords are present. This migration:
--
--   1. Defines a SQL function that computes haversine × 1.3 (road factor)
--      plus a speed-band time estimate — same math the edge function uses,
--      kept in sync by mirroring the constants.
--   2. Updates every row where coords exist AND distance_km is null/0.
--
-- Going forward bookings-create populates these at insert time. This
-- migration is the one-time catch-up for historical rows.
-- =============================================================================

-- Mirror of estimateBookingRoute() in supabase/functions/bookings-create/index.ts.
-- Returns NULL when either side is missing coords (labor-only bookings).
create or replace function calc_booking_route(
  p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_lat numeric, p_dropoff_lng numeric
) returns table (distance_km numeric, duration_min int) language plpgsql immutable as $$
declare
  straight_km numeric;
  road_km numeric;
  speed_kph numeric;
begin
  if p_pickup_lat is null or p_pickup_lng is null
     or p_dropoff_lat is null or p_dropoff_lng is null then
    return;
  end if;

  -- Haversine in km. Earth radius 6371.
  straight_km :=
    2 * 6371 * asin(sqrt(
      sin(radians(p_dropoff_lat - p_pickup_lat) / 2) ^ 2
      + cos(radians(p_pickup_lat)) * cos(radians(p_dropoff_lat))
        * sin(radians(p_dropoff_lng - p_pickup_lng) / 2) ^ 2
    ));

  road_km := straight_km * 1.3;
  speed_kph := case when road_km <= 30 then 40 else 80 end;

  distance_km := round(road_km::numeric, 1);
  duration_min := round(((road_km / speed_kph) * 60) + 5)::int;
  return next;
end $$;

-- Scalar helpers — Postgres doesn't allow the UPDATE target table in the
-- FROM clause (even with LATERAL), so we use two scalar functions and
-- compute everything in the SET clause. Same math as estimateBookingRoute.
create or replace function calc_route_road_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
) returns numeric language sql immutable as $$
  select round((
    2 * 6371 * asin(sqrt(
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * sin(radians(p_lng2 - p_lng1) / 2) ^ 2
    )) * 1.3
  )::numeric, 1);
$$;

create or replace function calc_route_drive_min(p_road_km numeric)
returns int language sql immutable as $$
  select (round(((p_road_km / case when p_road_km <= 30 then 40 else 80 end) * 60) + 5))::int;
$$;

-- Backfill — only rows that have both coords AND missing route data.
-- Idempotent: re-running is a no-op once distance_km is non-null and > 0.
update bookings
set
  distance_km = calc_route_road_km(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng),
  duration_min = calc_route_drive_min(
    calc_route_road_km(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
  )
where
  pickup_lat is not null and pickup_lng is not null
  and dropoff_lat is not null and dropoff_lng is not null
  and (distance_km is null or distance_km = 0);

notify pgrst, 'reload schema';
