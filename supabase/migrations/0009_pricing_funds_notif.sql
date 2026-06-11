-- =============================================================================
-- Movvy — Migration 0009: Full pricing breakdown + driver payouts + status notifications
-- =============================================================================
-- This migration adds:
--   1. Granular pricing columns on bookings (every line item your rate card calls for)
--   2. driver_payouts: who Movvy owes how much per booking (funds flow through Movvy)
--   3. DB trigger: every booking status change auto-creates a customer notification
--   4. Helper view: bookings_with_driver_split for easy admin / driver UI queries
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BOOKINGS: granular pricing breakdown
-- All in CENTS to avoid floats. Mirrors the engine in src/lib/pricing.ts.
-- -----------------------------------------------------------------------------

alter table bookings
  add column if not exists travel_hours numeric(5,1),          -- rounded to 0.5
  add column if not exists property_hours numeric(5,1),
  add column if not exists packing_hours numeric(5,1) default 0,
  add column if not exists additional_hours numeric(5,1) default 0,
  add column if not exists total_service_hours numeric(5,1),

  add column if not exists hourly_rate_customer_cents int,     -- 17500 or 22500
  add column if not exists hourly_rate_driver_cents int,       -- 13500 or 18500

  add column if not exists service_cost_cents int default 0,   -- hours × hourly_rate
  add column if not exists driver_earnings_cents int default 0,
  add column if not exists movvy_margin_cents int default 0,

  add column if not exists fuel_cents int default 0,
  add column if not exists fuel_route_km numeric(7,2),

  add column if not exists materials_cents int default 0,      -- 5000 or 12000
  add column if not exists insurance_cents int default 0,      -- 3000 or 0

  add column if not exists scale_charge_cents int default 0,   -- 4000 if travel > 10h
  add column if not exists accommodation_cents int default 0,  -- 30000 if travel > 10h

  add column if not exists service_tax_cents int default 0,    -- 5% of service subtotal
  add column if not exists materials_tax_cents int default 0,  -- 12% of materials

  add column if not exists deposit_cents int default 0,        -- ceil(total × 0.20)
  add column if not exists packing_service boolean default false,
  add column if not exists moving_insurance boolean default false;

-- Backfill default for the legacy `price_total_cents` workflow:
-- new code uses the granular columns; the old aggregate column stays for compat.

-- Safety: all monetary cents columns must be non-negative
alter table bookings
  add constraint bookings_money_nonneg check (
    coalesce(service_cost_cents, 0)    >= 0 and
    coalesce(driver_earnings_cents, 0) >= 0 and
    coalesce(fuel_cents, 0)            >= 0 and
    coalesce(materials_cents, 0)       >= 0 and
    coalesce(insurance_cents, 0)       >= 0 and
    coalesce(scale_charge_cents, 0)    >= 0 and
    coalesce(accommodation_cents, 0)   >= 0 and
    coalesce(deposit_cents, 0)         >= 0
  );

-- -----------------------------------------------------------------------------
-- DRIVER PAYOUTS — funds flow: customer → Movvy → driver/company
-- -----------------------------------------------------------------------------
-- Every completed booking owes money to one party (team or company).
-- Payouts are queued here. Stripe Connect actually moves the money in Phase 3.

create table driver_payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete restrict,

  -- Recipient (exactly one of these)
  team_id uuid references partner_teams(id) on delete restrict,
  company_id uuid references companies(id) on delete restrict,
  driver_profile_id uuid references profiles(id) on delete restrict,

  gross_cents int not null,        -- customer-paid service total (before Movvy margin)
  movvy_margin_cents int not null, -- our take ($40/hr × hours typically)
  net_cents int not null,          -- amount actually owed to the partner

  status payout_status not null default 'pending',
  scheduled_for date,              -- next weekly batch
  paid_at timestamptz,
  stripe_transfer_id text,
  failure_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dp_one_recipient check (
    (team_id is not null)::int +
    (company_id is not null)::int +
    (driver_profile_id is not null)::int = 1
  ),
  constraint dp_amounts_nonneg check (gross_cents >= 0 and net_cents >= 0 and movvy_margin_cents >= 0)
);

create index dp_team_idx on driver_payouts (team_id, status, scheduled_for);
create index dp_company_idx on driver_payouts (company_id, status, scheduled_for);
create index dp_driver_idx on driver_payouts (driver_profile_id, status, scheduled_for);
create index dp_booking_idx on driver_payouts (booking_id);

alter table driver_payouts enable row level security;
create policy dp_team_read on driver_payouts for select
  using (team_id is not null and is_team_member(team_id));
create policy dp_company_read on driver_payouts for select
  using (company_id is not null and is_company_admin(company_id));
create policy dp_driver_read on driver_payouts for select
  using (driver_profile_id is not null and driver_profile_id = auth.uid());
create policy dp_admin_all on driver_payouts for all using (is_admin()) with check (is_full_admin());

create trigger dp_set_updated_at before update on driver_payouts
  for each row execute function set_updated_at();

-- Auto-create a driver_payout row when a booking flips to 'completed'
create or replace function queue_driver_payout()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recipient_team uuid := null;
  v_recipient_company uuid := null;
  v_recipient_driver uuid := null;
begin
  if new.status <> 'completed' or (old.status is not null and old.status = 'completed') then
    return new;
  end if;

  -- Pick the recipient based on assignment
  if new.assigned_team_id is not null then
    v_recipient_team := new.assigned_team_id;
  elsif new.assigned_company_id is not null then
    v_recipient_company := new.assigned_company_id;
  elsif new.assigned_driver_profile_id is not null then
    v_recipient_driver := new.assigned_driver_profile_id;
  else
    return new;  -- nothing to pay out
  end if;

  insert into driver_payouts (
    booking_id, team_id, company_id, driver_profile_id,
    gross_cents, movvy_margin_cents, net_cents
  ) values (
    new.id, v_recipient_team, v_recipient_company, v_recipient_driver,
    new.service_cost_cents,
    new.movvy_margin_cents,
    new.driver_earnings_cents
  );

  return new;
end $$;

create trigger bookings_queue_payout
  after update on bookings
  for each row execute function queue_driver_payout();

-- -----------------------------------------------------------------------------
-- AUTO-NOTIFY CUSTOMER ON STATUS CHANGE
-- Every status transition writes an in_app notification (and later, push).
-- Customer's tracking screen subscribes to notifications via Realtime.
-- -----------------------------------------------------------------------------

create or replace function notify_customer_on_status_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_title text;
  v_body text;
  v_category text;
begin
  if new.status is null then return new; end if;
  if old.status is not null and old.status = new.status then return new; end if;

  v_category := 'booking.' || new.status;
  v_title := case new.status
    when 'searching'  then 'Looking for movers'
    when 'assigned'   then 'A crew has been assigned!'
    when 'confirmed'  then 'Your crew confirmed the move'
    when 'on_the_way' then 'Your crew is on the way'
    when 'arrived'    then 'Your crew has arrived at pickup'
    when 'loading'    then 'Loading has started'
    when 'in_transit' then 'On the way to drop-off'
    when 'unloading'  then 'Arrived at drop-off — unloading'
    when 'completed'  then 'Move complete!'
    when 'cancelled'  then 'Your move was cancelled'
    when 'failed'     then 'Your move could not be completed'
    else 'Move update'
  end;

  v_body := case new.status
    when 'on_the_way' then 'You can track them on the map.'
    when 'arrived'    then 'They will start loading soon.'
    when 'in_transit' then 'Tracking will show ETA to your drop-off.'
    when 'unloading'  then 'Almost done — they are unloading your items.'
    when 'completed'  then 'Tap to rate your move.'
    else 'Open your move to see details.'
  end;

  insert into notifications (profile_id, channel, category, title, body, data)
  values (
    new.customer_id, 'in_app', v_category, v_title, v_body,
    jsonb_build_object('booking_id', new.id, 'short_code', new.short_code, 'status', new.status)
  );

  return new;
end $$;

create trigger bookings_notify_status
  after insert or update of status on bookings
  for each row execute function notify_customer_on_status_change();
