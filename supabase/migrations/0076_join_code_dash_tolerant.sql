-- =============================================================================
-- 0076 — Make join_crew_by_code dash-tolerant.
--
-- Codes are now shown without dashes (COR5AMHB) but stored with them
-- (CO-R5AMHB). Normalize BOTH sides (strip everything but A–Z/0–9, uppercase)
-- when matching, so a person can type it either way.
-- =============================================================================

create or replace function join_crew_by_code(
  p_code text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_company companies;
  v_norm text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if length(v_norm) < 4 then raise exception 'Enter the full crew code.'; end if;

  select * into v_company from companies
  where regexp_replace(upper(invite_code), '[^A-Z0-9]', '', 'g') = v_norm
    and deleted_at is null
  limit 1;
  if not found then raise exception 'That code doesn''t match any crew. Check it and try again.'; end if;

  if exists (
    select 1 from company_members
    where company_id = v_company.id and profile_id = v_uid
      and org_role = 'admin' and removed_at is null
  ) then
    raise exception 'That''s your own code — share it with people you want on your crew.';
  end if;

  update company_members set removed_at = now()
  where profile_id = v_uid and org_role = 'crew' and removed_at is null
    and company_id <> v_company.id;

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

grant execute on function join_crew_by_code(text) to authenticated;
