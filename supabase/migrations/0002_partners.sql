-- =============================================================================
-- Movvy — Migration 0002: Partners (teams + companies)
-- Two partner kinds: 2-person teams, or moving companies with N drivers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- COMPANIES
-- -----------------------------------------------------------------------------

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  registration_number text not null,           -- GST/HST or business registration
  phone text not null,
  email citext not null,

  -- HQ
  primary_city_id uuid not null references cities(id),
  hq_line1 text not null,
  hq_line2 text,
  hq_city_name text not null,
  hq_region text not null,
  hq_country_code char(2) not null,
  hq_postal text,
  hq_lat numeric(9,6) not null,
  hq_lng numeric(9,6) not null,

  onboarding_status onboarding_status not null default 'invited',
  verified_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,

  -- Operations
  service_radius_km int not null default 25,
  truck_count int not null default 0,
  rating_avg numeric(3,2),
  rating_count int not null default 0,

  -- Payouts (Stripe Connect later)
  stripe_account_id text,                       -- acct_*
  payout_currency char(3) not null default 'CAD',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint companies_phone_format check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint companies_service_radius_valid check (service_radius_km > 0 and service_radius_km <= 500),
  constraint companies_coords_valid check (hq_lat between -90 and 90 and hq_lng between -180 and 180)
);

create index companies_primary_city_idx on companies (primary_city_id);
create index companies_status_idx on companies (onboarding_status);
create index companies_active_idx on companies (deleted_at) where deleted_at is null;
create unique index companies_registration_idx on companies (registration_number);

-- Add the FK that was forward-declared in 0001
alter table vehicles
  add constraint vehicles_company_fk
  foreign key (company_id) references companies(id) on delete set null;

-- -----------------------------------------------------------------------------
-- COMPANY MEMBERSHIPS
-- Owner / dispatcher / driver — many profiles can belong to a company.
-- -----------------------------------------------------------------------------

create type company_member_role as enum ('owner', 'dispatcher', 'driver');

create table company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role company_member_role not null,
  -- Driver-only fields (null for owner/dispatcher)
  driver_license_number text,
  driver_license_expiry date,
  vehicle_id uuid references vehicles(id) on delete set null,
  -- Lifecycle
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  is_active boolean generated always as (removed_at is null) stored,

  constraint company_members_driver_has_license check (
    role <> 'driver' or driver_license_number is not null
  )
);

create unique index company_members_unique_active
  on company_members (company_id, profile_id) where removed_at is null;
create index company_members_company_idx on company_members (company_id);
create index company_members_profile_idx on company_members (profile_id);

-- -----------------------------------------------------------------------------
-- PARTNER TEAMS (2-person crew model)
-- One driver + one mover, both must be verified before either can take jobs.
-- -----------------------------------------------------------------------------

create table partner_teams (
  id uuid primary key default gen_random_uuid(),
  display_name text,                           -- "Adam & Marcus"
  primary_city_id uuid not null references cities(id),
  onboarding_status onboarding_status not null default 'invited',
  verified_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,

  service_radius_km int not null default 15,
  rating_avg numeric(3,2),
  rating_count int not null default 0,

  -- Payouts
  stripe_account_id text,
  payout_currency char(3) not null default 'CAD',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint partner_teams_service_radius_valid check (service_radius_km > 0 and service_radius_km <= 200)
);

create index partner_teams_primary_city_idx on partner_teams (primary_city_id);
create index partner_teams_status_idx on partner_teams (onboarding_status);

create type team_role as enum ('driver', 'mover');

create table partner_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references partner_teams(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role team_role not null,
  driver_license_number text,
  driver_license_expiry date,
  vehicle_id uuid references vehicles(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,

  constraint ptm_driver_has_license check (
    role <> 'driver' or driver_license_number is not null
  )
);

-- Exactly one driver + one mover per active team
create unique index ptm_unique_role_per_team
  on partner_team_members (team_id, role) where removed_at is null;
create unique index ptm_unique_profile_active
  on partner_team_members (profile_id) where removed_at is null;
create index ptm_team_idx on partner_team_members (team_id);

-- -----------------------------------------------------------------------------
-- VERIFICATION DOCUMENTS
-- Government IDs, licenses, insurance — uploaded to Supabase Storage,
-- this table stores only metadata + the storage path.
-- -----------------------------------------------------------------------------

create table verification_documents (
  id uuid primary key default gen_random_uuid(),
  -- Subject: a profile, a team, or a company
  profile_id uuid references profiles(id) on delete cascade,
  team_id uuid references partner_teams(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,

  kind document_kind not null,
  storage_bucket text not null,
  storage_path text not null,                  -- 'verifications/<id>/license.jpg'
  mime_type text,
  size_bytes int,
  expires_at date,

  status document_status not null default 'pending',
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),

  constraint vd_one_subject check (
    (profile_id is not null)::int +
    (team_id is not null)::int +
    (company_id is not null)::int = 1
  )
);

create index vd_profile_idx on verification_documents (profile_id);
create index vd_team_idx on verification_documents (team_id);
create index vd_company_idx on verification_documents (company_id);
create index vd_status_idx on verification_documents (status);

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();
create trigger partner_teams_set_updated_at before update on partner_teams
  for each row execute function set_updated_at();
