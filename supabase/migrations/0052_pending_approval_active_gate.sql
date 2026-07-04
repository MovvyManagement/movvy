-- =============================================================================
-- Movvy — Migration 0052: Gate every "is this an active member?" path on
-- status = 'active'
--
-- Migration 0051 added a `status` column to partner_team_members +
-- company_members with the Option-C join flow: anyone with a valid invite
-- code can self-join, landing in status='pending_approval' until an owner
-- approves them. It also keeps 'rejected' rows around for audit.
--
-- PROBLEM: every membership-resolving helper written before 0051 only filtered
-- `removed_at IS NULL`. A pending_approval row (and a rejected row) has
-- removed_at IS NULL — so those rows were treated as *active members*
-- everywhere:
--   • is_company_member / is_team_member / is_company_admin → RLS read access
--   • my_company_role / my_company_id → dispatch gating
--   • company_drivers_roster / partner_team_roster → showed pending people as crew
--   • my_partner_distance_km / can_browse_open_jobs → open-job-pool visibility
--
-- A pending (unapproved) person could therefore read the org's data, appear in
-- the roster, and — combined with the pre-0052 edge functions — be assigned to
-- real customer moves. This migration closes all of that by requiring
-- status='active' in every path. We KEEP the `removed_at IS NULL` clause too
-- (belt-and-suspenders / explicit intent), even though the 0051 sync trigger
-- already guarantees removed_at → status='removed'.
--
-- Edge functions (bookings-accept, bookings-dispatch-*) get the matching
-- `.eq('status','active')` guard in their own change set.
--
-- Backfill from 0051 set every legacy row to 'active', so NO existing active
-- member loses access.
-- =============================================================================

-- ─── RLS role helpers (originally 0005) ──────────────────────────────────────

create or replace function is_company_member(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id
      and profile_id = auth.uid()
      and status = 'active'
      and removed_at is null
  );
$$;

create or replace function is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id
      and profile_id = auth.uid()
      and role in ('owner', 'dispatcher')
      and status = 'active'
      and removed_at is null
  );
$$;

create or replace function is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from partner_team_members
    where team_id = p_team_id
      and profile_id = auth.uid()
      and status = 'active'
      and removed_at is null
  );
$$;

-- ─── Dispatch helpers (originally 0017) ───────────────────────────────────────

create or replace function my_company_role(p_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role::text
  from company_members
  where company_id = p_company_id
    and profile_id = auth.uid()
    and status = 'active'
    and removed_at is null
  limit 1;
$$;

create or replace function my_company_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select company_id
  from company_members
  where profile_id = auth.uid()
    and status = 'active'
    and removed_at is null
  limit 1;
$$;

-- ─── Company driver roster (current def is 0018 — with presence fields) ───────
-- Only ACTIVE drivers appear in the dispatcher's "assign driver" picker, so a
-- pending_approval driver can never be handed a live move.

create or replace function company_drivers_roster(p_company_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext,
  phone text,
  driver_license_number text,
  active_jobs int,
  is_online boolean,
  last_online_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  select my_company_role(p_company_id) into v_role;
  if v_role not in ('owner', 'dispatcher') then return; end if;

  return query
    select cm.profile_id,
           p.full_name,
           p.email,
           p.phone,
           cm.driver_license_number,
           coalesce((
             select count(*)::int from bookings b
             where b.assigned_driver_profile_id = cm.profile_id
               and b.status in ('assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading')
           ), 0) as active_jobs,
           (p.is_online and p.last_online_at > now() - interval '30 minutes') as is_online,
           p.last_online_at
    from company_members cm
    join profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id
      and cm.role = 'driver'
      and cm.status = 'active'
      and cm.removed_at is null
      and p.deleted_at is null
    order by
      (p.is_online and p.last_online_at > now() - interval '30 minutes') desc,
      cm.driver_license_number nulls last,
      p.full_name;
end;
$$;

-- ─── Independent-operator team roster (originally 0040) ───────────────────────

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
  if not is_team_member(p_team_id) then return; end if;

  return query
    select ptm.profile_id,
           p.full_name,
           p.email,
           p.phone,
           ptm.role,
           ptm.driver_license_number,
           coalesce((
             select count(*)::int from bookings b
             where b.assigned_team_id = p_team_id
               and b.status in ('assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading')
           ), 0) as active_jobs,
           (p.is_online and p.last_online_at > now() - interval '30 minutes') as is_online,
           p.last_online_at
    from partner_team_members ptm
    join profiles p on p.id = ptm.profile_id
    where ptm.team_id = p_team_id
      and ptm.status = 'active'
      and ptm.removed_at is null
      and p.deleted_at is null
    order by
      (ptm.role = 'driver') desc,
      (p.is_online and p.last_online_at > now() - interval '30 minutes') desc,
      p.full_name;
end;
$$;

-- ─── Open-job-pool visibility (originally 0036 + 0038) ────────────────────────
-- A pending/rejected partner can no longer see the open move pool.

create or replace function my_partner_distance_km(p_lat numeric, p_lng numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select min(movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng))
  from cities c
  where c.id in (
    select pt.primary_city_id
      from partner_team_members ptm
      join partner_teams pt on pt.id = ptm.team_id
     where ptm.profile_id = auth.uid()
       and ptm.status = 'active'
       and ptm.removed_at is null
    union
    select co.primary_city_id
      from company_members cm
      join companies co on co.id = cm.company_id
     where cm.profile_id = auth.uid()
       and cm.status = 'active'
       and cm.removed_at is null
       and cm.role in ('owner', 'dispatcher')
  );
$$;

-- Superseded by my_partner_distance_km for the bookings policy, but still
-- defined + grantable. Tightened for defense-in-depth.
create or replace function can_browse_open_jobs(p_city_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from partner_team_members ptm
    join partner_teams pt on pt.id = ptm.team_id
    where ptm.profile_id = auth.uid()
      and ptm.status = 'active'
      and ptm.removed_at is null
      and pt.primary_city_id = p_city_id
  )
  or exists (
    select 1
    from company_members cm
    join companies c on c.id = cm.company_id
    where cm.profile_id = auth.uid()
      and cm.status = 'active'
      and cm.removed_at is null
      and cm.role in ('owner', 'dispatcher')
      and c.primary_city_id = p_city_id
  );
$$;

-- ─── Self-service "where is my join request?" RPC ─────────────────────────────
-- After 0052 tightened is_team_member / is_company_member, a pending or
-- rejected member can no longer read the parent partner_teams / companies row
-- via RLS (correct — they aren't a member yet). But the waiting-for-approval
-- screen still needs the org's display name + their status. This SECURITY
-- DEFINER function returns ONLY the caller's own pending/rejected membership,
-- so it can't be used to enumerate anyone else's data.
create or replace function my_pending_membership()
returns table (
  kind text,             -- 'team' | 'company'
  subject_id uuid,
  org_name text,
  member_role text,
  status text,
  rejected_reason text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- Company membership takes precedence if somehow both exist.
  return query
    select 'company'::text, cm.company_id, c.display_name, cm.role::text,
           cm.status, cm.rejected_reason
    from company_members cm
    join companies c on c.id = cm.company_id
    where cm.profile_id = auth.uid()
      and cm.status in ('pending_approval', 'rejected')
      and cm.removed_at is null
    order by (cm.status = 'pending_approval') desc
    limit 1;
  if found then return; end if;

  return query
    select 'team'::text, ptm.team_id, t.display_name, ptm.role::text,
           ptm.status, ptm.rejected_reason
    from partner_team_members ptm
    join partner_teams t on t.id = ptm.team_id
    where ptm.profile_id = auth.uid()
      and ptm.status in ('pending_approval', 'rejected')
      and ptm.removed_at is null
    order by (ptm.status = 'pending_approval') desc
    limit 1;
end;
$$;

revoke all on function my_pending_membership() from public;
grant execute on function my_pending_membership() to authenticated;

-- ─── Owner-facing: list my org's pending join requests ────────────────────────
-- Powers the "Pending approvals" section on the crew/drivers screens. Gated so
-- only an ACTIVE owner/dispatcher (company) or the ACTIVE operator (team) can
-- read their own org's pending applicants. SECURITY DEFINER so it can join to
-- profiles for the applicant's name/contact without widening profiles RLS.
create or replace function pending_join_requests(p_kind text, p_subject_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext,
  phone text,
  member_role text,
  requested_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'company' then
    -- Caller must be an active owner/dispatcher of this company.
    if not is_company_admin(p_subject_id) then return; end if;
    return query
      select cm.profile_id, p.full_name, p.email, p.phone, cm.role::text,
             coalesce(cm.invited_at, cm.accepted_at) as requested_at
      from company_members cm
      join profiles p on p.id = cm.profile_id
      where cm.company_id = p_subject_id
        and cm.status = 'pending_approval'
        and cm.removed_at is null
        and p.deleted_at is null
      order by p.full_name;
  elsif p_kind = 'team' then
    -- Caller must be the active operator (driver) of this team.
    if not exists (
      select 1 from partner_team_members
      where team_id = p_subject_id
        and profile_id = auth.uid()
        and role = 'driver'
        and status = 'active'
        and removed_at is null
    ) then
      return;
    end if;
    return query
      select ptm.profile_id, p.full_name, p.email, p.phone, ptm.role::text,
             coalesce(ptm.invited_at, ptm.accepted_at) as requested_at
      from partner_team_members ptm
      join profiles p on p.id = ptm.profile_id
      where ptm.team_id = p_subject_id
        and ptm.status = 'pending_approval'
        and ptm.removed_at is null
        and p.deleted_at is null
      order by p.full_name;
  end if;
end;
$$;

revoke all on function pending_join_requests(text, uuid) from public;
grant execute on function pending_join_requests(text, uuid) to authenticated;
