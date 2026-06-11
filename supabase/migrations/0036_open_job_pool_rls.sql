-- =============================================================================
-- Movvy — Migration 0036: Let partners read the OPEN job pool
--
-- Problem: a customer's brand-new booking is inserted at status='searching'
-- with no assigned driver/team/company yet. The only partner-facing SELECT
-- policy on `bookings` was `bookings_partner_select`, which allows reads ONLY
-- via is_assigned_to_booking(id) — i.e. a job ALREADY assigned to you. So an
-- unassigned 'searching' booking was invisible to every driver, and the
-- solo/team driver feed (useAvailableJobs, a direct `from('bookings')` query)
-- always came back empty. The customer's move never popped up on the driver
-- side.
--
-- (Companies were unaffected because their dispatch feed reads through the
-- SECURITY DEFINER dispatch_queue() RPC, which bypasses RLS.)
--
-- Fix: a permissive SELECT policy that exposes the OPEN pool (searching +
-- unassigned) to partners who operate in that booking's city. Scoped by
-- city so an Edmonton crew can't enumerate Calgary's pending moves.
--
-- Note on verification: this only governs VISIBILITY of the open pool.
-- Actually ACCEPTING a job is still gated by can_take_jobs() inside the
-- bookings-accept edge function (background check + ID + approved docs), so a
-- not-yet-verified partner can see the queue but cannot take a customer's
-- move. We intentionally do NOT require onboarding_status='verified' here:
-- teams/companies are created 'in_progress', and gating visibility on
-- 'verified' would leave a freshly-onboarded partner staring at an empty
-- feed with no idea why.
-- =============================================================================

-- Helper — true when the caller is an active partner operating in p_city_id.
-- SECURITY DEFINER so it can read the membership tables without recursing
-- back into their own RLS. Mirrors the recipient set the bookings-create
-- edge function broadcasts to (all team members; company owners/dispatchers).
create or replace function can_browse_open_jobs(p_city_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from partner_team_members ptm
    join partner_teams pt on pt.id = ptm.team_id
    where ptm.profile_id = auth.uid()
      and ptm.removed_at is null
      and pt.primary_city_id = p_city_id
  )
  or exists (
    select 1
    from company_members cm
    join companies c on c.id = cm.company_id
    where cm.profile_id = auth.uid()
      and cm.removed_at is null
      and cm.role in ('owner', 'dispatcher')
      and c.primary_city_id = p_city_id
  );
$$;

grant execute on function can_browse_open_jobs(uuid) to authenticated, service_role;

-- Permissive SELECT policy. RLS policies are OR-combined, so this ADDS open-
-- pool visibility on top of the existing customer / assigned-partner / admin
-- policies without weakening any of them.
drop policy if exists bookings_open_pool_select on bookings;

create policy bookings_open_pool_select on bookings for select
  using (
    status = 'searching'
    and assigned_driver_profile_id is null
    and assigned_team_id is null
    and assigned_company_id is null
    and can_browse_open_jobs(city_id)
  );
