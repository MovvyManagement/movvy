-- =============================================================================
-- Movvy — Migration 0001: Core schema
-- Cities (multi-city from day 1), profiles, addresses, vehicles, enums.
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive emails

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

create type user_role as enum (
  'customer',
  'driver',
  'mover',
  'company_owner',
  'company_dispatcher',
  'movvy_admin',
  'movvy_support'
);

create type partner_kind as enum ('team', 'company');

create type onboarding_status as enum (
  'invited',
  'in_progress',
  'docs_uploaded',
  'in_review',
  'verified',
  'suspended',
  'rejected'
);

create type move_type as enum (
  'home_move',
  'commercial',
  'single_items',
  'labor_only'
);

create type booking_status as enum (
  'draft',
  'pending',         -- payment authorized, looking for crew
  'searching',
  'assigned',
  'confirmed',
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
  'completed',
  'cancelled',
  'failed'
);

create type schedule_mode as enum ('asap', 'scheduled');

create type vehicle_type as enum ('cargo_van', 'cube_van_16', 'box_truck_24', 'box_truck_26', 'pickup_truck', 'other');

create type document_kind as enum (
  'gov_id',
  'driver_license',
  'vehicle_registration',
  'insurance',
  'business_registration',
  'wcb',
  'fleet_insurance',
  'selfie_with_id'
);

create type document_status as enum ('pending', 'approved', 'rejected', 'expired');

create type rating_party as enum ('customer_to_partner', 'partner_to_customer');

create type dispute_kind as enum ('damage', 'late', 'no_show', 'poor_service', 'overcharge', 'other');
create type dispute_status as enum ('open', 'in_review', 'resolved_customer', 'resolved_partner', 'closed');

create type payout_status as enum ('pending', 'processing', 'paid', 'failed');
create type payment_status as enum ('uncharged', 'authorized', 'captured', 'partially_refunded', 'refunded', 'failed');

-- -----------------------------------------------------------------------------
-- CITIES (multi-city ready)
-- Every city we operate in gets a row. Rates + tax + commission stored per-city.
-- -----------------------------------------------------------------------------

create table cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                    -- 'calgary', 'edmonton'
  name text not null,                           -- 'Calgary'
  country_code char(2) not null,                -- 'CA', 'US'
  region text not null,                         -- 'AB', 'ON', 'NY'
  timezone text not null,                       -- 'America/Edmonton'

  -- Service area
  center_lat numeric(9,6) not null,
  center_lng numeric(9,6) not null,
  bounds_n  numeric(9,6) not null,
  bounds_s  numeric(9,6) not null,
  bounds_e  numeric(9,6) not null,
  bounds_w  numeric(9,6) not null,

  -- Activation / launch
  is_active boolean not null default false,     -- can customers book here?
  is_accepting_partners boolean not null default false,
  launched_at timestamptz,

  -- Pricing (per-city overrides)
  currency char(3) not null default 'CAD',
  commission_rate numeric(4,3) not null default 0.170,  -- 17%
  tax_rate numeric(4,3) not null default 0.050,         -- 5% GST AB; 13% HST ON; etc.
  rate_hourly_commercial numeric(6,2) not null default 89.00,
  rate_hourly_labor numeric(6,2) not null default 55.00,
  rate_per_km numeric(5,2) not null default 1.60,
  rate_home_base numeric(7,2) not null default 169.00,
  rate_home_per_bedroom numeric(6,2) not null default 65.00,
  rate_home_per_living numeric(6,2) not null default 35.00,
  rate_items_base numeric(7,2) not null default 49.00,
  rate_items_per_item numeric(6,2) not null default 28.00,
  booking_lead_days int not null default 3,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cities_bounds_valid check (bounds_n > bounds_s and bounds_e > bounds_w),
  constraint cities_rates_positive check (
    commission_rate >= 0 and commission_rate < 1
    and tax_rate >= 0 and tax_rate < 1
    and rate_hourly_commercial > 0
    and rate_hourly_labor > 0
    and rate_per_km >= 0
    and booking_lead_days >= 0
  )
);

create index cities_active_idx on cities (is_active) where is_active;
create index cities_slug_idx on cities (slug);

-- -----------------------------------------------------------------------------
-- PROFILES
-- Every auth.users entry has a corresponding profile.
-- Role is stored both here AND in auth.users.app_metadata for fast RLS checks.
-- -----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  full_name text,
  display_name text,
  phone text,                                   -- E.164 format enforced via app + edge fn
  email citext,                                 -- denormalized from auth.users for queries
  avatar_url text,

  home_city_id uuid references cities(id),
  preferred_language char(2) default 'en',

  email_verified_at timestamptz,
  phone_verified_at timestamptz,

  -- Anti-abuse / lifecycle
  is_suspended boolean not null default false,
  suspended_reason text,
  suspended_at timestamptz,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_phone_format check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$')
);

create index profiles_role_idx on profiles (role);
create index profiles_home_city_idx on profiles (home_city_id);
create index profiles_email_idx on profiles (email);
create index profiles_active_idx on profiles (deleted_at) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- ADDRESSES
-- Saved addresses + ad-hoc booking addresses (snapshot in booking jsonb).
-- -----------------------------------------------------------------------------

create table saved_addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text,                                   -- 'Home', 'Work'
  line1 text not null,
  line2 text,
  city_id uuid not null references cities(id),
  city_name text not null,
  region text not null,
  country_code char(2) not null,
  postal text,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint addr_coords_valid check (lat between -90 and 90 and lng between -180 and 180)
);

create index saved_addresses_profile_idx on saved_addresses (profile_id);
create unique index saved_addresses_one_default
  on saved_addresses (profile_id) where is_default;

-- -----------------------------------------------------------------------------
-- VEHICLES
-- -----------------------------------------------------------------------------

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references profiles(id) on delete set null,
  company_id uuid,                              -- forward ref; FK added in migration 0002
  type vehicle_type not null,
  make text,
  model text,
  year int,
  plate text not null,
  province text not null,
  capacity_cu_ft int,
  created_at timestamptz not null default now(),
  constraint vehicles_year_valid check (year is null or (year between 1950 and 2100)),
  constraint vehicles_owner_or_company check (owner_profile_id is not null or company_id is not null)
);

create unique index vehicles_plate_province_idx on vehicles (plate, province);

-- -----------------------------------------------------------------------------
-- UPDATED_AT TRIGGER
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger cities_set_updated_at before update on cities
  for each row execute function set_updated_at();
