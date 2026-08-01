-- =============================================================================
-- 0073 — Single-operator partner model (foundation).
--
-- New model: there is no "company vs team vs driver vs mover". Every partner
-- signs up the same way and gets their OWN lightweight org (a `companies` row)
-- with a unique CO- code — they're its admin. Entering someone else's code
-- makes you an active CREW member of THEIR org instantly (no approval); the
-- code owner is the admin who sees pricing and assigns work. You can leave a
-- crew to go back to running solo.
--
-- The `companies` table was built for formal, registered moving companies
-- (legal name, GST number, full HQ address). The operator model is much
-- lighter — a display name, an HQ city, and a truck. This migration relaxes the
-- formal NOT NULLs so a one-tap operator org can exist, and adds the three RPCs
-- the app calls: create_operator_org, join_crew_by_code, leave_crew.
-- =============================================================================

-- ── 1. Relax the formal-company requirements ────────────────────────────────
-- These have no equivalent for an individual operator. CHECK constraints on
-- these columns still hold because a CHECK passes when the value is NULL.
alter table companies alter column legal_name          drop not null;
alter table companies alter column registration_number drop not null;
alter table companies alter column phone               drop not null;
alter table companies alter column email               drop not null;
alter table companies alter column hq_line1            drop not null;

-- ── 2. create_operator_org ──────────────────────────────────────────────────
-- Bootstraps the caller's own org from signup. HQ is populated from the chosen
-- city's centroid (the operator just picks a city, not a street address). If
-- the caller already owns an admin org, that one is returned instead of making
-- a duplicate. The company insert trigger fills invite_code (their unique code).
create or replace function create_operator_org(
  p_display_name text,
  p_city_id uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_city cities;
  v_company_id uuid;
  v_prof profiles;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_display_name), '') = '' then raise exception 'A name is required'; end if;

  -- Already an admin of an org? Reuse it (idempotent signup).
  select company_id into v_company_id
  from company_members
  where profile_id = v_uid and org_role = 'admin' and removed_at is null
  limit 1;
  if v_company_id is not null then return v_company_id; end if;

  select * into v_city from cities where id = p_city_id;
  if not found then raise exception 'Unknown city'; end if;
  select * into v_prof from profiles where id = v_uid;

  insert into companies (
    legal_name, display_name, registration_number, phone, email,
    primary_city_id, hq_line1, hq_city_name, hq_region, hq_country_code,
    hq_lat, hq_lng, onboarding_status
  ) values (
    trim(p_display_name), trim(p_display_name), null, v_prof.phone, v_prof.email,
    v_city.id, v_city.name, v_city.name, v_city.region, v_city.country_code,
    v_city.center_lat, v_city.center_lng, 'invited'
  ) returning id into v_company_id;

  -- Creator is the admin/owner.
  insert into company_members (company_id, profile_id, role, org_role, status)
  values (v_company_id, v_uid, 'owner', 'admin', 'active');

  return v_company_id;
end $$;

-- ── 3. join_crew_by_code ────────────────────────────────────────────────────
-- Instant join: enter an org's CO- code and you're an active crew member right
-- away (the admin sees you by name and can remove you later). You can only be
-- crew of one org at a time, so any prior crew membership is dropped first. You
-- can't "join" your own org.
create or replace function join_crew_by_code(
  p_code text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_company companies;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_company from companies
  where upper(invite_code) = upper(trim(p_code)) and deleted_at is null;
  if not found then raise exception 'That code doesn''t match any crew. Check it and try again.'; end if;

  -- Can't join an org you already run.
  if exists (
    select 1 from company_members
    where company_id = v_company.id and profile_id = v_uid
      and org_role = 'admin' and removed_at is null
  ) then
    raise exception 'That''s your own code — share it with people you want on your crew.';
  end if;

  -- One crew at a time: release any other crew membership first.
  update company_members set removed_at = now()
  where profile_id = v_uid and org_role = 'crew' and removed_at is null
    and company_id <> v_company.id;

  -- Already an active crew member here? Nothing to do.
  if exists (
    select 1 from company_members
    where company_id = v_company.id and profile_id = v_uid and removed_at is null
  ) then
    return jsonb_build_object('company_id', v_company.id, 'company_name', v_company.display_name);
  end if;

  insert into company_members (company_id, profile_id, role, org_role, status)
  values (v_company.id, v_uid, 'driver', 'crew', 'active');

  return jsonb_build_object('company_id', v_company.id, 'company_name', v_company.display_name);
end $$;

-- ── 4. leave_crew ───────────────────────────────────────────────────────────
-- Drop the caller's crew membership(s), returning them to running solo under
-- their own org. Admins can't "leave" their own org (they'd delete it instead).
create or replace function leave_crew() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  update company_members set removed_at = now()
  where profile_id = v_uid and org_role = 'crew' and removed_at is null;
end $$;

grant execute on function create_operator_org(text, uuid) to authenticated;
grant execute on function join_crew_by_code(text) to authenticated;
grant execute on function leave_crew() to authenticated;
