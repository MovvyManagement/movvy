-- =============================================================================
-- Movvy — Migration 0066: unified org role model (Stage 1 of company/mover merge)
--
-- GOAL of the merge: collapse the two parallel partner structures —
--   • partner_teams   (rigid 2-person: 1 "driver" operator + 1 "mover" laborer)
--   • companies       (many: owner / dispatcher / driver)
-- into ONE "organization" concept with just two tiers:
--   • admin  — accepts jobs, assigns crew, sees pricing/revenue, onboards/removes
--   • crew   — performs assigned moves; never sees dollar figures
-- A solo mover becomes an "org of one" where they are the admin.
--
-- THIS migration is Stage 1: it is deliberately ADDITIVE and backwards-
-- compatible. It introduces the org_role tier and loosens the companies
-- constraints WITHOUT removing the legacy role enums or the partner_teams
-- tables, so the currently-installed app keeps working while later stages
-- migrate data, unify the login, and retire the team tables.
--
-- Legacy role → org_role mapping (used for backfill + the sync triggers):
--   company_members:      owner, dispatcher → admin      driver → crew
--   partner_team_members: driver (operator) → admin      mover  → crew
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The unified two-tier role
-- -----------------------------------------------------------------------------
do $$ begin
  create type org_role as enum ('admin', 'crew');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. Add org_role to both membership tables + backfill from the legacy role
-- -----------------------------------------------------------------------------
alter table company_members      add column if not exists org_role org_role;
alter table partner_team_members add column if not exists org_role org_role;

update company_members
   set org_role = case when role in ('owner', 'dispatcher') then 'admin'::org_role
                       else 'crew'::org_role end
 where org_role is null;

update partner_team_members
   set org_role = case when role = 'driver' then 'admin'::org_role
                       else 'crew'::org_role end
 where org_role is null;

-- Keep org_role authoritative even when the OLD app (which knows nothing about
-- org_role) inserts a membership using only the legacy `role`. A BEFORE trigger
-- derives org_role from role so the column is never left null.
create or replace function set_company_member_org_role()
returns trigger language plpgsql as $$
begin
  if new.org_role is null then
    new.org_role := case when new.role in ('owner', 'dispatcher') then 'admin'::org_role
                         else 'crew'::org_role end;
  end if;
  return new;
end $$;

drop trigger if exists company_members_org_role on company_members;
create trigger company_members_org_role
  before insert or update on company_members
  for each row execute function set_company_member_org_role();

create or replace function set_team_member_org_role()
returns trigger language plpgsql as $$
begin
  if new.org_role is null then
    new.org_role := case when new.role = 'driver' then 'admin'::org_role
                         else 'crew'::org_role end;
  end if;
  return new;
end $$;

drop trigger if exists team_members_org_role on partner_team_members;
create trigger team_members_org_role
  before insert or update on partner_team_members
  for each row execute function set_team_member_org_role();

-- -----------------------------------------------------------------------------
-- 3. Generalize `companies` so a solo/independent mover is an org of one.
--    The business-only fields (legal name, GST/registration number, HQ street
--    address, HQ coordinates, business phone/email) become optional. An
--    individual signs up with just a display name + a primary city.
--    display_name and primary_city_id stay required — every org needs a name
--    and a base city (the base city drives job-proximity matching).
--    The unique index on registration_number is unaffected: Postgres allows
--    multiple NULLs, so solo orgs (null number) don't collide, while real
--    businesses keep their uniqueness.
-- -----------------------------------------------------------------------------
alter table companies alter column legal_name          drop not null;
alter table companies alter column registration_number drop not null;
alter table companies alter column phone               drop not null;
alter table companies alter column email               drop not null;
alter table companies alter column hq_line1            drop not null;
alter table companies alter column hq_city_name        drop not null;
alter table companies alter column hq_region           drop not null;
alter table companies alter column hq_country_code     drop not null;
alter table companies alter column hq_lat              drop not null;
alter table companies alter column hq_lng              drop not null;

-- -----------------------------------------------------------------------------
-- 4. is_org_admin() — the single source of truth for "can see money / manage
--    people", spanning BOTH membership tables during the transition. Later
--    stages collapse everything onto companies and this simplifies.
--    SECURITY DEFINER + fixed search_path, mirroring is_company_admin().
-- -----------------------------------------------------------------------------
create or replace function is_org_admin(p_profile uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from company_members cm
     where cm.profile_id = p_profile and cm.removed_at is null
       and cm.org_role = 'admin'
  ) or exists (
    select 1 from partner_team_members ptm
     where ptm.profile_id = p_profile and ptm.removed_at is null
       and ptm.org_role = 'admin'
  );
$$;

revoke all on function is_org_admin(uuid) from public;
grant execute on function is_org_admin(uuid) to authenticated, service_role;
