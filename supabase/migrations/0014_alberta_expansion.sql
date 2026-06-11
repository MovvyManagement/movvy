-- =============================================================================
-- Movvy — Migration 0014: Province-wide expansion (all of Alberta)
--
-- Adds Edmonton + 8 other Alberta major cities. Each gets its own:
--   - Service-area bounding box (loose, to cover the metro)
--   - Rate card (same defaults as Calgary; admin can adjust per city)
--   - is_active = true (customers can book now)
--   - is_accepting_partners = true (partners can sign up now)
--
-- Bookings outside any city's bounds will be routed to the closest HQ city by
-- straight-line distance via src/lib/distance.ts — so a booking in Banff,
-- Drumheller, or Vermilion is still serviceable.
--
-- City-bounds + slugs are kept in kebab-case to match URL conventions.
-- =============================================================================

insert into cities (
  slug, name, country_code, region, timezone,
  center_lat, center_lng,
  bounds_n, bounds_s, bounds_e, bounds_w,
  is_active, is_accepting_partners, launched_at,
  currency, commission_rate, tax_rate,
  rate_hourly_commercial, rate_hourly_labor,
  rate_per_km, rate_home_base, rate_home_per_bedroom, rate_home_per_living,
  rate_items_base, rate_items_per_item,
  booking_lead_days
) values
  -- Edmonton metro
  (
    'edmonton', 'Edmonton', 'CA', 'AB', 'America/Edmonton',
    53.5461, -113.4938,
    53.7099, 53.3955, -113.2902, -113.7106,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Red Deer (between Calgary + Edmonton)
  (
    'red-deer', 'Red Deer', 'CA', 'AB', 'America/Edmonton',
    52.2681, -113.8112,
    52.3300, 52.2100, -113.7400, -113.8800,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Lethbridge (southern AB)
  (
    'lethbridge', 'Lethbridge', 'CA', 'AB', 'America/Edmonton',
    49.6956, -112.8451,
    49.7400, 49.6600, -112.7400, -112.9200,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Medicine Hat (SE AB)
  (
    'medicine-hat', 'Medicine Hat', 'CA', 'AB', 'America/Edmonton',
    50.0405, -110.6764,
    50.0900, 50.0000, -110.6100, -110.7400,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Grande Prairie (NW AB)
  (
    'grande-prairie', 'Grande Prairie', 'CA', 'AB', 'America/Edmonton',
    55.1707, -118.7947,
    55.2100, 55.1300, -118.7400, -118.8600,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Fort McMurray
  (
    'fort-mcmurray', 'Fort McMurray', 'CA', 'AB', 'America/Edmonton',
    56.7264, -111.3803,
    56.7800, 56.6800, -111.3000, -111.4600,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Airdrie (Calgary commuter)
  (
    'airdrie', 'Airdrie', 'CA', 'AB', 'America/Edmonton',
    51.2917, -114.0144,
    51.3500, 51.2700, -113.9700, -114.0700,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- St. Albert (Edmonton commuter)
  (
    'st-albert', 'St. Albert', 'CA', 'AB', 'America/Edmonton',
    53.6305, -113.6256,
    53.6700, 53.6000, -113.5800, -113.6900,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  ),
  -- Okotoks (south of Calgary)
  (
    'okotoks', 'Okotoks', 'CA', 'AB', 'America/Edmonton',
    50.7236, -113.9750,
    50.7500, 50.6900, -113.9300, -113.9900,
    true, true, now(),
    'CAD', 0.170, 0.050,
    89.00, 55.00, 1.60, 169.00, 65.00, 35.00, 49.00, 28.00, 3
  )
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Province-level service area (used for Alberta-wide geocoding bounds)
-- Loose box covering ~all of inhabited Alberta
-- -----------------------------------------------------------------------------

create or replace function alberta_bounds()
returns table(bounds_n numeric, bounds_s numeric, bounds_e numeric, bounds_w numeric)
language sql immutable as $$
  select 60.0::numeric, 49.0::numeric, -110.0::numeric, -120.0::numeric;
$$;

grant execute on function alberta_bounds() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Helper: find the closest ACTIVE city to a given coord. Used by bookings-create
-- when the pickup is outside any single city's bounds (e.g. Banff, Drumheller).
-- -----------------------------------------------------------------------------

create or replace function find_closest_active_city(p_lat numeric, p_lng numeric)
returns table (id uuid, slug text, name text, distance_km numeric)
language sql stable as $$
  -- Haversine in SQL; returns nearest active city
  select c.id, c.slug, c.name,
    ( 2 * 6371 * asin(
        sqrt(
          power(sin(radians((c.center_lat - p_lat) / 2)), 2)
          + cos(radians(p_lat)) * cos(radians(c.center_lat))
            * power(sin(radians((c.center_lng - p_lng) / 2)), 2)
        )
      )
    )::numeric as distance_km
  from cities c
  where c.is_active
  order by distance_km
  limit 1;
$$;

grant execute on function find_closest_active_city(numeric, numeric) to authenticated, service_role;
