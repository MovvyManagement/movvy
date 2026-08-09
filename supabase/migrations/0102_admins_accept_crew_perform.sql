-- =============================================================================
-- Migration 0102 — admins take the work, crew perform it
--
-- Founder decision, and it makes the whole partner model simpler:
--
--   • Only an org ADMIN can accept a job from the open pool.
--   • The admin then assigns it to a crew member.
--   • That assignment is the ONLY way a job reaches a crew member.
--   • Whoever performs it, the money settles to the org — so the banking
--     details on a payout are always the admin's.
--
-- This deliberately REVERSES part of 0096. That migration widened open-pool
-- visibility to crew on the theory that "anyone accepts, admin assigns
-- performers". The product rule is now the opposite, and the old behaviour was
-- actively bad for the crew member: they could see a list of jobs, tap one, and
-- be refused — bookings-accept has always thrown 403 for role='driver'
-- (bookings-accept:69). Showing someone work they cannot take is worse than
-- showing them nothing.
--
-- Crew are not left with an empty app: they get their assigned moves, which is
-- exactly what /(mover)/(tabs)/jobs already renders under "My Jobs" with the
-- banner "Your dispatcher assigns moves to you."
-- =============================================================================

-- ── Am I an admin of any org? ───────────────────────────────────────────────
-- org_role is the canonical tier (0066). Kept separate from is_company_admin(),
-- which takes a specific company and reads the LEGACY role column.
create or replace function i_am_org_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from company_members cm
     where cm.profile_id = auth.uid()
       and cm.org_role = 'admin'
       and cm.status = 'active'
       and cm.removed_at is null
  ) or exists (
    -- Legacy teams: a team member is their own operator, so they act as admin.
    select 1
      from partner_team_members ptm
     where ptm.profile_id = auth.uid()
       and ptm.status = 'active'
       and ptm.removed_at is null
  );
$$;

grant execute on function i_am_org_admin() to authenticated, service_role;

-- ── Open pool: admins only ──────────────────────────────────────────────────
-- Still bounded by the org's own job radius from 0100.
drop policy if exists bookings_open_pool_select on bookings;
create policy bookings_open_pool_select on bookings for select
  using (
    status = 'searching'
    and assigned_driver_profile_id is null
    and assigned_team_id is null
    and assigned_company_id is null
    and i_am_org_admin()
    and coalesce(my_partner_distance_km(pickup_lat, pickup_lng), 1e9)
        <= my_partner_job_radius_km()
  );

-- ── The feed follows the same rule ──────────────────────────────────────────
-- Returns nothing for a crew member rather than a list they can't act on.
create or replace function open_jobs_for_me(p_radius_km numeric default null)
returns setof bookings language sql stable security definer set search_path = public, pg_temp as $$
  select b.*
  from bookings b
  where i_am_org_admin()
    and b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9)
        <= least(coalesce(p_radius_km, 1e9), my_partner_job_radius_km())
  order by b.scheduled_for_date asc, b.created_at asc;
$$;

grant execute on function open_jobs_for_me(numeric) to authenticated, service_role;

-- ── An assigned crew member must always be able to READ their move ──────────
-- The app asks for exactly this (useJobs.ts: assigned_driver_profile_id OR
-- tracking_profile_id), but the policy only covered is_assigned_to_booking(),
-- which has no tracking_profile_id branch. So the crew member chosen as the
-- live-location source — whoever pressed "We've left HQ" — could be broadcasting
-- their position for a move they cannot read. On a two-person crew that is a
-- blank screen for the person actually driving.
--
-- SELECT only. Writes stay locked by 0101 (status + updated_at, nothing else).
drop policy if exists bookings_partner_select on bookings;
create policy bookings_partner_select on bookings for select
  using (
    is_assigned_to_booking(id)
    or tracking_profile_id = auth.uid()
  );

notify pgrst, 'reload schema';
