-- =============================================================================
-- 0081 — New operator orgs must land in the admin approvals queue.
--
-- create_operator_org() stamped onboarding_status = 'invited', but the web
-- admin's approvals queue only lists ('in_review','docs_uploaded','in_progress').
-- So every partner who signed up in the app was invisible to Movvy admins —
-- nobody could ever verify them, and once verification gating is switched on
-- they'd be permanently unable to perform a move.
--
-- The operator onboarding uploads the driver's licence + government ID BEFORE
-- it calls this function, so by the time the org row exists the documents are
-- already in. 'docs_uploaded' is therefore the accurate state, and it puts the
-- new org straight in front of an admin for review.
-- =============================================================================

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
    v_city.center_lat, v_city.center_lng, 'docs_uploaded'
  ) returning id into v_company_id;

  insert into company_members (company_id, profile_id, role, org_role, status)
  values (v_company_id, v_uid, 'owner', 'admin', 'active');

  return v_company_id;
end $$;

grant execute on function create_operator_org(text, uuid) to authenticated;

-- Any operator org already created under the old 'invited' stamp should be
-- reviewable too, otherwise early signups stay stranded.
update companies set onboarding_status = 'docs_uploaded'
where onboarding_status = 'invited' and deleted_at is null;
