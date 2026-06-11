-- =============================================================================
-- Movvy — Migration 0040: Independent-operator crew tools
--
-- Goal: give a solo/independent team driver (the OPERATOR) the same crew-building
-- functionality a company has — an invite-code generator + the ability to add and
-- manage hourly movers. Until now a partner_team was hard-capped at exactly one
-- driver + one mover (ptm_unique_role_per_team), so an operator couldn't grow a
-- crew the way a company onboards multiple drivers.
--
-- Two changes:
--   1. Relax the one-mover cap. This is safe because the team model already treats
--      the crew as a unit: bookings are assigned to the TEAM (assigned_team_id),
--      not to individual movers; useMyTeamCurrentJob resolves the team's in-flight
--      job from ANY member row; the job-offer popup + payout/revenue surfaces only
--      ever target the operator (team driver) — movers are hourly laborers with
--      revenue hidden. So a team can carry one operator + many movers, mirroring a
--      company carrying many drivers. We keep "exactly one operator per team" and
--      drop only the mover cap.
--   2. Add partner_team_roster(p_team_id) — the team analog of
--      company_drivers_roster (migration 0018), so the operator's Crew screen can
--      list members with online presence + active-job state. Gated on
--      is_team_member so only the crew can read its own roster.
-- =============================================================================

-- 1. Relax role uniqueness: one operator (driver) per team, many movers.
--    The old index enforced one row per (team_id, role); the new one only caps
--    the driver/operator role, leaving movers unbounded.
drop index if exists ptm_unique_role_per_team;
create unique index ptm_unique_driver_per_team
  on partner_team_members (team_id)
  where role = 'driver' and removed_at is null;

-- 2. Crew roster for the operator's Crew screen. Mirrors company_drivers_roster
--    but returns every active member (operator + movers) and is gated on team
--    membership rather than a company admin role.
create or replace function partner_team_roster(p_team_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext,
  phone text,
  role team_role,
  driver_license_number text,
  active_jobs int,
  is_online boolean,
  last_online_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- Only members of the team may read its roster.
  if not is_team_member(p_team_id) then return; end if;

  return query
    select ptm.profile_id,
           p.full_name,
           p.email,
           p.phone,
           ptm.role,
           ptm.driver_license_number,
           -- The whole crew works the same team booking, so reflect the team's
           -- in-flight job count for everyone — this lights up the "On job" badge
           -- for the operator and their movers together while a move is active.
           coalesce((
             select count(*)::int from bookings b
             where b.assigned_team_id = p_team_id
               and b.status in ('assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading')
           ), 0) as active_jobs,
           -- Treat "online flag true AND seen within 30 min" as effectively online,
           -- matching the company roster's idle-timeout rule.
           (p.is_online and p.last_online_at > now() - interval '30 minutes') as is_online,
           p.last_online_at
    from partner_team_members ptm
    join profiles p on p.id = ptm.profile_id
    where ptm.team_id = p_team_id
      and ptm.removed_at is null
      and p.deleted_at is null
    order by
      -- Operator (driver) first, then online crew, then by name.
      (ptm.role = 'driver') desc,
      (p.is_online and p.last_online_at > now() - interval '30 minutes') desc,
      p.full_name;
end;
$$;

revoke all on function partner_team_roster(uuid) from public;
grant execute on function partner_team_roster(uuid) to authenticated;
