-- =============================================================================
-- 0089 — Long-distance moves bill transit by the kilometre, not by the clock.
--
-- Two modes, chosen by the pickup → drop-off distance:
--
--   LOCAL (≤ 100 km)      everything hourly, exactly as before:
--                         HQ → pickup, the drive between addresses, and the
--                         work on site all run on the same rate.
--
--   LONG-HAUL (> 100 km)  the work stays hourly, the highway does not.
--                         Load and unload are clocked and billed at the rate;
--                         the drive between the two addresses is a fixed
--                         distance × $3.50/km. That per-km rate covers the
--                         crew's time on the road, the fuel, the wear AND the
--                         empty drive home, which is why the round-trip
--                         doubling from 0088 is retired here.
--
-- Why fix the transit: a hundred-kilometre-plus drive on a meter means traffic,
-- weather and a stop for lunch all land on the customer's invoice, and nobody
-- can quote a firm price. Fixing it makes the quote a promise. The customer
-- still only pays for the hours actually worked at either end.
--
-- These columns freeze the quote's transit figures onto the booking so the
-- FINAL bill reuses the exact number the customer agreed to, rather than
-- recomputing a distance months later against a changed road network.
-- =============================================================================

alter table bookings
  add column if not exists transit_km numeric(8,1),
  add column if not exists transit_cents int not null default 0,
  add column if not exists is_long_haul boolean not null default false;

comment on column bookings.transit_km is
  'One-way pickup → drop-off driving distance measured at booking time.';
comment on column bookings.transit_cents is
  'Fixed transit charge for a long-haul move (transit_km × the per-km rate). 0 on local moves, where the drive is billed hourly instead.';
comment on column bookings.is_long_haul is
  'True when transit_km exceeded the long-haul threshold at booking time. Frozen: the final bill must use the mode the customer was quoted.';

-- The completed-move view an admin reads should show which mode billed it.
create index if not exists bookings_long_haul_idx on bookings (is_long_haul)
  where is_long_haul;
