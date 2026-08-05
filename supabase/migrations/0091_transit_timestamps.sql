-- =============================================================================
-- 0091 — Stamp the transit window on the booking itself.
--
-- The customer's live billing meter has to know when the truck got on the
-- highway and when it got off: on a long haul that span is paid for by the
-- kilometre, so the meter pauses through it. Without these columns the app
-- would have to pull booking_status_history on every render of a screen that
-- ticks once a second.
--
-- History remains the source of truth for the FINAL bill — it's written by a
-- trigger and can't be skipped. These two are a denormalised read path for the
-- live screen, and a fallback for bookings that predate them.
-- =============================================================================

alter table bookings
  add column if not exists in_transit_at timestamptz,
  add column if not exists unloading_at timestamptz;

comment on column bookings.in_transit_at is
  'When the crew left the pickup with the load. Start of the transit window.';
comment on column bookings.unloading_at is
  'When the crew reached the drop-off and began unloading. End of the transit window.';

-- Backfill from history so moves already in flight get a correct meter.
update bookings b
   set in_transit_at = h.first_at
  from (
    select booking_id, min(created_at) as first_at
    from booking_status_history
    where new_status = 'in_transit'
    group by booking_id
  ) h
 where h.booking_id = b.id and b.in_transit_at is null;

update bookings b
   set unloading_at = h.first_at
  from (
    select booking_id, min(created_at) as first_at
    from booking_status_history
    where new_status = 'unloading'
    group by booking_id
  ) h
 where h.booking_id = b.id and b.unloading_at is null;
