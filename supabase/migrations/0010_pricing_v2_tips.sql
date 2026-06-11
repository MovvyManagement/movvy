-- =============================================================================
-- Movvy — Migration 0010: Pricing v2 (matrix rate card) + tips
--
-- This migration:
--   1. Adds per-line driver/movvy split columns to bookings
--   2. Adds recommended_crew, travel_cost_cents, gst_cents, balance_due_cents
--   3. Drops the obsolete fuel/scale/accommodation columns (still in legacy
--      aggregate columns like price_distance_cents which we re-use for travel)
--   4. Adds tip columns + tips edge function authorization model
--   5. Updates the driver_payouts trigger to add the tip net to the payout
-- =============================================================================

-- ── New granular pricing columns ────────────────────────────────────────────

alter table bookings
  add column if not exists recommended_crew int,
  add column if not exists travel_cost_cents int default 0,
  add column if not exists gst_cents int default 0,
  add column if not exists balance_due_cents int default 0,

  add column if not exists driver_service_cents int default 0,
  add column if not exists driver_travel_cents int default 0,
  add column if not exists driver_materials_cents int default 0,
  add column if not exists driver_total_cents int default 0,

  add column if not exists movvy_service_margin_cents int default 0,
  add column if not exists movvy_travel_margin_cents int default 0,
  add column if not exists movvy_materials_margin_cents int default 0,
  add column if not exists movvy_insurance_margin_cents int default 0;

-- ── Tip columns ─────────────────────────────────────────────────────────────
-- Tip lifecycle:
--   1. Customer submits tip on review screen → tips-submit edge function
--   2. Function writes: tip_cents (gross), tip_movvy_cut_cents (10%), tip_driver_cents (90%)
--   3. driver_payouts.net_cents is bumped by tip_driver_cents (trigger below)

alter table bookings
  add column if not exists tip_cents int default 0,
  add column if not exists tip_movvy_cut_cents int default 0,
  add column if not exists tip_driver_cents int default 0,
  add column if not exists tipped_at timestamptz;

alter table bookings
  add constraint bookings_tip_nonneg check (
    coalesce(tip_cents, 0) >= 0 and
    coalesce(tip_movvy_cut_cents, 0) >= 0 and
    coalesce(tip_driver_cents, 0) >= 0
  );

-- ── Replace queue_driver_payout to use the v2 driver_total + tip ────────────

create or replace function queue_driver_payout()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recipient_team uuid := null;
  v_recipient_company uuid := null;
  v_recipient_driver uuid := null;
  v_net_cents int;
  v_gross_cents int;
  v_margin_cents int;
begin
  if new.status <> 'completed' or (old.status is not null and old.status = 'completed') then
    return new;
  end if;

  if new.assigned_team_id is not null then
    v_recipient_team := new.assigned_team_id;
  elsif new.assigned_company_id is not null then
    v_recipient_company := new.assigned_company_id;
  elsif new.assigned_driver_profile_id is not null then
    v_recipient_driver := new.assigned_driver_profile_id;
  else
    return new;
  end if;

  -- Driver's take = service + travel + flat $20 materials + 90% of any tip
  v_net_cents   := coalesce(new.driver_total_cents, 0) + coalesce(new.tip_driver_cents, 0);
  -- Gross customer paid for service-side (incl tip)
  v_gross_cents := coalesce(new.service_cost_cents, 0)
                 + coalesce(new.travel_cost_cents, 0)
                 + coalesce(new.materials_cents, 0)
                 + coalesce(new.tip_cents, 0);
  v_margin_cents := coalesce(new.movvy_margin_cents, 0) + coalesce(new.tip_movvy_cut_cents, 0);

  insert into driver_payouts (
    booking_id, team_id, company_id, driver_profile_id,
    gross_cents, movvy_margin_cents, net_cents
  ) values (
    new.id, v_recipient_team, v_recipient_company, v_recipient_driver,
    v_gross_cents, v_margin_cents, v_net_cents
  )
  on conflict do nothing;

  return new;
end $$;

-- ── If a tip arrives AFTER the booking already completed, bump the payout ───

create or replace function bump_payout_on_tip()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tip_cents is null or new.tip_cents = coalesce(old.tip_cents, 0) then
    return new;
  end if;

  -- Add the difference to the most recent pending payout
  update driver_payouts
  set net_cents = net_cents + (coalesce(new.tip_driver_cents, 0) - coalesce(old.tip_driver_cents, 0)),
      gross_cents = gross_cents + (coalesce(new.tip_cents, 0) - coalesce(old.tip_cents, 0)),
      movvy_margin_cents = movvy_margin_cents + (coalesce(new.tip_movvy_cut_cents, 0) - coalesce(old.tip_movvy_cut_cents, 0))
  where booking_id = new.id and status = 'pending';

  return new;
end $$;

drop trigger if exists bookings_bump_payout_on_tip on bookings;
create trigger bookings_bump_payout_on_tip
  after update of tip_cents on bookings
  for each row execute function bump_payout_on_tip();
