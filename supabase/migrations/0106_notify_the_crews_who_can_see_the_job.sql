-- =============================================================================
-- Migration 0106 — notify exactly the crews who can see the job
--
-- partners-broadcast picked recipients by `primary_city_id = booking.city_id`,
-- while the job feed and the open-pool RLS policy use "within the org's own
-- service radius of the pickup". Two different rules, so two different sets:
--
--   • An Okotoks booking: Calgary crews are 36 km away, so it IS in their feed —
--     but they were never notified, so nobody looked.
--   • MV-1025's Canmore pickup carried city_id = calgary, so every Calgary
--     partner WAS pushed about a job that RLS then refused to open. A
--     notification into a dead end.
--
-- This returns the recipients using the same geometry as visibility, so the two
-- sets are identical by construction rather than by two functions agreeing.
--
-- Only org ADMINS are returned: since 0102, only an admin can accept a job, so
-- notifying a crew member about the open pool would be telling them about work
-- they cannot take. Crew hear about a move when their admin assigns it.
-- =============================================================================

create or replace function crew_admins_to_notify(p_lat numeric, p_lng numeric)
returns table (profile_id uuid, company_id uuid, team_id uuid, distance_km numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  -- Companies: admins only (org_role from 0066).
  select cm.profile_id,
         co.id as company_id,
         null::uuid as team_id,
         round(movvy_km_between(ci.center_lat, ci.center_lng, p_lat, p_lng)::numeric, 1)
    from company_members cm
    join companies co on co.id = cm.company_id
    join cities ci on ci.id = co.primary_city_id
   where cm.status = 'active'
     and cm.removed_at is null
     and cm.org_role = 'admin'
     and co.onboarding_status = 'verified'
     and ci.is_active
     and movvy_km_between(ci.center_lat, ci.center_lng, p_lat, p_lng)
         <= coalesce(co.service_radius_km, 60)

  union

  -- Legacy teams: a team member is their own operator, so they act as admin.
  select ptm.profile_id,
         null::uuid as company_id,
         pt.id as team_id,
         round(movvy_km_between(ci.center_lat, ci.center_lng, p_lat, p_lng)::numeric, 1)
    from partner_team_members ptm
    join partner_teams pt on pt.id = ptm.team_id
    join cities ci on ci.id = pt.primary_city_id
   where ptm.status = 'active'
     and ptm.removed_at is null
     and pt.onboarding_status = 'verified'
     and ci.is_active
     and movvy_km_between(ci.center_lat, ci.center_lng, p_lat, p_lng)
         <= coalesce(pt.service_radius_km, 60);
$$;

grant execute on function crew_admins_to_notify(numeric, numeric) to service_role;

comment on function crew_admins_to_notify(numeric, numeric) is
  'Org admins whose service radius covers this pickup — the same geometry the open-pool RLS policy and open_jobs_for_me use, so the crews notified are exactly the crews who can see and accept the job (0106).';

notify pgrst, 'reload schema';
