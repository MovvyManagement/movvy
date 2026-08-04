-- =============================================================================
-- 0088 — A crew shares its trucks, and the app must resolve the SAME crew the
-- rest of the app thinks you're working in.
--
-- The capacity rules were already org-scoped: org_can_take_booking() counts the
-- ORG's vehicles and the ORG's registration, and assignment never asked whether
-- the performer owns a truck. So joining a crew with a 24 ft truck already lets
-- you work 24 ft jobs with nothing registered to you personally.
--
-- Except my_fleet_readiness() (0085) resolved the org the wrong way round. A
-- person who owns their own org AND has joined someone's crew has TWO active
-- memberships; useMyMembership() and org_open_jobs() both prefer the JOINED
-- crew, but readiness preferred their own admin org — the empty one. So the
-- exact case this is meant to support (register with no truck, join a crew that
-- has one) reported "add your truck" and blocked the accept.
--
-- One rule, everywhere: the crew you JOINED is the crew you're working in.
-- =============================================================================

create or replace function my_fleet_readiness()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company_id uuid;
  v_trucks int := 0;
  v_max_ft int := 0;
  v_reg jsonb;
  v_ins jsonb;
begin
  select cm.company_id into v_company_id
  from company_members cm
  where cm.profile_id = auth.uid()
    and cm.status = 'active'
    and cm.removed_at is null
  -- A joined crew wins over your own org — same precedence as
  -- useMyMembership() and org_open_jobs().
  order by cm.org_role = 'crew' desc
  limit 1;

  if v_company_id is null then
    return jsonb_build_object(
      'company_id', null, 'truck_count', 0, 'max_truck_ft', 0,
      'registration', jsonb_build_object('status', 'missing'),
      'insurance', jsonb_build_object('status', 'missing')
    );
  end if;

  -- Every truck the CREW owns, whoever registered it.
  select count(*), coalesce(max(coalesce(length_ft, 0)), 0)
    into v_trucks, v_max_ft
  from vehicles where company_id = v_company_id;

  with mine as (
    select d.*
    from verification_documents d
    where d.kind in ('vehicle_registration', 'insurance')
      and (
        d.company_id = v_company_id
        or d.profile_id in (
          select profile_id from company_members
          where company_id = v_company_id and removed_at is null
        )
      )
  )
  select
    (select jsonb_build_object('status', m.status::text, 'rejection_reason', m.rejection_reason,
                               'reviewed_at', m.reviewed_at, 'created_at', m.created_at)
       from mine m where m.kind = 'vehicle_registration'
      order by (m.status = 'approved') desc, m.created_at desc limit 1),
    (select jsonb_build_object('status', m.status::text, 'rejection_reason', m.rejection_reason,
                               'reviewed_at', m.reviewed_at, 'created_at', m.created_at)
       from mine m where m.kind = 'insurance'
      order by (m.status = 'approved') desc, m.created_at desc limit 1)
  into v_reg, v_ins;

  return jsonb_build_object(
    'company_id', v_company_id,
    'truck_count', v_trucks,
    'max_truck_ft', v_max_ft,
    'registration', coalesce(v_reg, jsonb_build_object('status', 'missing')),
    'insurance', coalesce(v_ins, jsonb_build_object('status', 'missing')),
    -- Lets the app word the blocker correctly: only an admin can act on it.
    'is_org_admin', (
      select cm.org_role = 'admin'
      from company_members cm
      where cm.profile_id = auth.uid() and cm.company_id = v_company_id
        and cm.removed_at is null
      limit 1
    )
  );
end $$;

grant execute on function my_fleet_readiness() to authenticated;
