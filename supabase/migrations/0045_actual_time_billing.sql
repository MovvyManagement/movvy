-- =============================================================================
-- Migration 0045 — Actual-time billing
--
-- Switches Movvy from estimate-based billing to ACTUAL-time billing.
-- Customer agrees to an estimate at booking. On move day, the driver
-- presses "Begin Move" when they arrive at the pickup — that records
-- bookings.started_at. When the move finishes, "Finish Move" records
-- bookings.completed_at and the server computes the actual bill from
-- the elapsed time × hourly rate + materials + fuel + GST.
--
-- Columns added:
--   actual_hours              — (completed_at − started_at) in hours, 2 dp
--   fuel_cents                — long-haul fuel charge captured at booking time
--                               (mirrored to actual bill — distance is fixed)
--   actual_subtotal_cents     — actual_service + materials + fuel
--   actual_gst_cents          — 5% of actual_subtotal
--   actual_total_cents        — ceil(subtotal + gst) — what customer pays
--   actual_commission_cents   — Movvy's 20% slice of actual_total
--   actual_driver_payout_cents — 80% of actual_total to the driver
--
-- price_total_cents stays as the ESTIMATE (what customer agreed to at
-- booking). actual_total_cents is the FINAL bill. Both rows are kept
-- so the customer / driver / Movvy can compare the two.
-- =============================================================================

alter table bookings
  add column if not exists actual_hours numeric(5, 2),
  add column if not exists fuel_cents integer not null default 0,
  add column if not exists actual_subtotal_cents integer,
  add column if not exists actual_gst_cents integer,
  add column if not exists actual_total_cents integer,
  add column if not exists actual_commission_cents integer,
  add column if not exists actual_driver_payout_cents integer;

-- Sanity: actual_* should only be non-null when completed.
-- Postgres has no IF NOT EXISTS for ADD CONSTRAINT, so we guard with DO + EXCEPTION.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_actual_complete'
  ) then
    alter table bookings
      add constraint bookings_actual_complete check (
        (actual_total_cents is null and actual_hours is null)
        or (actual_total_cents is not null and actual_hours is not null and actual_hours >= 0)
      );
  end if;
end $$;

notify pgrst, 'reload schema';
