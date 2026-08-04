-- =============================================================================
-- 0087 — Finishing partner onboarding registers the partner side.
--
-- 0086 stamps the side at signup (from the form's role metadata) and 0086's
-- backfill covers everyone who already existed, but neither covers the case
-- where those stamps are missing and the person nevertheless completes
-- onboarding: creating your org IS being a partner. Stamping here means the
-- partner door can never refuse someone who owns a Movvy org.
--
-- Also stamped in join_crew_by_code for the same reason — being someone's crew
-- is partner activity, whatever route brought you there.
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

  -- Already an admin of an org? Reuse it (idempotent signup).
  select company_id into v_company_id
  from company_members
  where profile_id = v_uid and org_role = 'admin' and removed_at is null
  limit 1;
  if v_company_id is not null then
    update profiles set partner_registered_at = coalesce(partner_registered_at, now())
     where id = v_uid;
    return v_company_id;
  end if;

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

  -- Creator is the admin/owner.
  insert into company_members (company_id, profile_id, role, org_role, status)
  values (v_company_id, v_uid, 'owner', 'admin', 'active');

  -- Owning an org means the partner side is registered.
  update profiles set partner_registered_at = coalesce(partner_registered_at, now())
   where id = v_uid;

  return v_company_id;
end $$;

grant execute on function create_operator_org(text, uuid) to authenticated;
