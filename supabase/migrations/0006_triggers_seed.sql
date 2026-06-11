-- =============================================================================
-- Movvy — Migration 0006: Triggers, helpers, seed data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AUTO-CREATE PROFILE WHEN auth.users row is inserted
-- (Supabase Auth handles signup; we mirror to public.profiles.)
-- -----------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, email, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'customer'),
    new.email::citext,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- BOOKING SHORT CODE GENERATOR (MV-XXXXX)
-- Globally unique, no collisions even at scale.
-- -----------------------------------------------------------------------------

create sequence if not exists booking_short_seq start 1000;

create or replace function gen_booking_short_code()
returns text language sql as $$
  select 'MV-' || nextval('booking_short_seq');
$$;

create or replace function set_booking_short_code()
returns trigger language plpgsql as $$
begin
  if new.short_code is null or new.short_code = '' then
    new.short_code := gen_booking_short_code();
  end if;
  return new;
end $$;

create trigger bookings_short_code
  before insert on bookings
  for each row execute function set_booking_short_code();

-- -----------------------------------------------------------------------------
-- BOOKING STATE MACHINE ENFORCEMENT
-- Only specific transitions allowed; admins bypass.
-- -----------------------------------------------------------------------------

create or replace function enforce_booking_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Admins can override
  if is_admin() then
    return new;
  end if;

  if old.status = new.status then
    return new;
  end if;

  v_allowed := case
    when old.status = 'draft'      and new.status in ('pending', 'cancelled') then true
    when old.status = 'pending'    and new.status in ('searching', 'cancelled', 'failed') then true
    when old.status = 'searching'  and new.status in ('assigned', 'cancelled', 'failed') then true
    when old.status = 'assigned'   and new.status in ('confirmed', 'cancelled') then true
    when old.status = 'confirmed'  and new.status in ('on_the_way', 'cancelled') then true
    when old.status = 'on_the_way' and new.status in ('arrived', 'cancelled') then true
    when old.status = 'arrived'    and new.status in ('loading', 'cancelled') then true
    when old.status = 'loading'    and new.status in ('in_transit', 'cancelled') then true
    when old.status = 'in_transit' and new.status in ('unloading', 'cancelled') then true
    when old.status = 'unloading'  and new.status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_allowed then
    raise exception 'Invalid booking status transition: % → %', old.status, new.status
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  return new;
end $$;

create trigger bookings_enforce_transition
  before update of status on bookings
  for each row execute function enforce_booking_status_transition();

-- -----------------------------------------------------------------------------
-- LOCK CRITICAL BOOKING FIELDS AFTER CONFIRMATION
-- Customer can't change pickup/dropoff/price once a driver is assigned.
-- -----------------------------------------------------------------------------

create or replace function lock_booking_after_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_admin() then return new; end if;

  if old.status in ('assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading','completed') then
    if new.pickup_lat is distinct from old.pickup_lat
       or new.pickup_lng is distinct from old.pickup_lng
       or new.dropoff_lat is distinct from old.dropoff_lat
       or new.dropoff_lng is distinct from old.dropoff_lng
       or new.price_total_cents is distinct from old.price_total_cents
       or new.move_type is distinct from old.move_type
       or new.scheduled_for_date is distinct from old.scheduled_for_date
    then
      raise exception 'Cannot modify locked booking fields after assignment'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_lock_after_assignment
  before update on bookings
  for each row execute function lock_booking_after_assignment();

-- -----------------------------------------------------------------------------
-- RATING AGGREGATE TRIGGERS — keep partner/company rating_avg fresh
-- -----------------------------------------------------------------------------

create or replace function refresh_partner_team_rating(p_team_id uuid)
returns void language sql as $$
  update partner_teams
  set rating_avg = (select avg(overall)::numeric(3,2) from ratings where to_team_id = p_team_id),
      rating_count = (select count(*) from ratings where to_team_id = p_team_id)
  where id = p_team_id;
$$;

create or replace function refresh_company_rating(p_company_id uuid)
returns void language sql as $$
  update companies
  set rating_avg = (select avg(overall)::numeric(3,2) from ratings where to_company_id = p_company_id),
      rating_count = (select count(*) from ratings where to_company_id = p_company_id)
  where id = p_company_id;
$$;

create or replace function after_rating_change()
returns trigger language plpgsql as $$
begin
  if new.to_team_id is not null then perform refresh_partner_team_rating(new.to_team_id); end if;
  if new.to_company_id is not null then perform refresh_company_rating(new.to_company_id); end if;
  return new;
end $$;

create trigger ratings_refresh_aggregates
  after insert on ratings
  for each row execute function after_rating_change();

-- -----------------------------------------------------------------------------
-- SEED: Calgary
-- -----------------------------------------------------------------------------

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
) values (
  'calgary', 'Calgary', 'CA', 'AB', 'America/Edmonton',
  51.0447, -114.0719,
  51.2125, 50.8425, -113.8585, -114.2710,
  true, true, now(),
  'CAD', 0.170, 0.050,
  89.00, 55.00,
  1.60, 169.00, 65.00, 35.00,
  49.00, 28.00,
  3
) on conflict (slug) do nothing;
