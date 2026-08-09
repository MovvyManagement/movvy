-- =============================================================================
-- Migration 0100 — the crew's own job radius decides what it sees
--
-- Two numbers governed "can this crew see this job" and they didn't agree with
-- each other or with the product:
--
--   • Each org already stores its OWN radius — partner_teams.service_radius_km
--     (0002:35, default 25) and companies.service_radius_km (0002:109, default
--     15). The partner picks it in EditServiceAreaSheet, from steps of
--     5/10/15/25/50/100/200 km, and that sheet tells them in plain words:
--     "jobs outside this radius won't be offered to you."
--
--   • Nothing on the server ever read it. 0038 hardcoded 60 km in both the
--     bookings_open_pool_select RLS policy and open_jobs_for_me(). So the
--     setting was stored, shown, and ignored — a crew that set 5 km still got
--     jobs 60 km away, and one that set 200 km never saw anything past 60.
--
-- Worse, bookings-create accepted any pickup within 200 km and took the
-- deposit. Everything from 60 to 200 km was created, paid for, and invisible to
-- every crew. That is not hypothetical: MV-1025 (Canmore pickup, 90.4 km from
-- the nearest HQ) collected a $399.00 deposit with deposit_status 'paid' and
-- then died with "Expired — no company accepted before the move date". Two of
-- the fifteen bookings in the table are in that band and both are dead.
--
-- This migration makes the crew's stored radius the single source of truth, and
-- gives the booking side a way to ask "can ANY crew actually see this?" so we
-- stop charging people for moves nobody will ever be offered.
-- =============================================================================

-- ── 1. What radius does the signed-in partner actually work to? ─────────────
-- MAX across their orgs: if someone belongs to a 25 km team and a 100 km
-- company, they can legitimately see the 100 km job through the latter. Falls
-- back to 60 to preserve the old behaviour for any org with a NULL.
create or replace function my_partner_job_radius_km()
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(r), 60) from (
    select pt.service_radius_km::numeric as r
      from partner_team_members ptm
      join partner_teams pt on pt.id = ptm.team_id
     where ptm.profile_id = auth.uid()
       and ptm.status = 'active'
       and ptm.removed_at is null
    union all
    select co.service_radius_km::numeric
      from company_members cm
      join companies co on co.id = cm.company_id
     where cm.profile_id = auth.uid()
       and cm.status = 'active'
       and cm.removed_at is null
  ) s;
$$;

grant execute on function my_partner_job_radius_km() to authenticated, service_role;

-- ── 2. RLS: visibility uses the crew's own number, not 60 ──────────────────
drop policy if exists bookings_open_pool_select on bookings;
create policy bookings_open_pool_select on bookings for select
  using (
    status = 'searching'
    and assigned_driver_profile_id is null
    and assigned_team_id is null
    and assigned_company_id is null
    and coalesce(my_partner_distance_km(pickup_lat, pickup_lng), 1e9)
        <= my_partner_job_radius_km()
  );

-- ── 3. The feed RPC follows the same rule ──────────────────────────────────
-- p_radius_km now defaults to NULL meaning "use my org's setting". A caller may
-- still pass a SMALLER number to narrow their own view, but passing a larger one
-- can't widen it past what the org chose — otherwise the RPC would hand back
-- rows the RLS policy on the job-detail screen then refuses to open, which is
-- exactly the dead-end MV-1025 produced.
create or replace function open_jobs_for_me(p_radius_km numeric default null)
returns setof bookings language sql stable security definer set search_path = public, pg_temp as $$
  select b.*
  from bookings b
  where b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9)
        <= least(coalesce(p_radius_km, 1e9), my_partner_job_radius_km())
  order by b.scheduled_for_date asc, b.created_at asc;
$$;

grant execute on function open_jobs_for_me(numeric) to authenticated, service_role;

-- ── 4. Can ANYONE see a job at this pickup? ────────────────────────────────
-- Used at booking time so we never take a deposit for a move that no crew's
-- radius reaches. Deliberately counts only orgs that could actually take work:
-- verified onboarding, at least one active member. SECURITY DEFINER because the
-- caller is an anonymous-ish customer who cannot read partner tables.
create or replace function any_crew_covers_pickup(p_lat numeric, p_lng numeric)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from partner_teams pt
      join cities c on c.id = pt.primary_city_id
     where pt.onboarding_status = 'verified'
       and c.is_active
       and movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng)
           <= coalesce(pt.service_radius_km, 60)
       and exists (
         select 1 from partner_team_members ptm
          where ptm.team_id = pt.id and ptm.status = 'active' and ptm.removed_at is null
       )
    union all
    select 1
      from companies co
      join cities c on c.id = co.primary_city_id
     where co.onboarding_status = 'verified'
       and c.is_active
       and movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng)
           <= coalesce(co.service_radius_km, 60)
       and exists (
         select 1 from company_members cm
          where cm.company_id = co.id and cm.status = 'active' and cm.removed_at is null
       )
  );
$$;

grant execute on function any_crew_covers_pickup(numeric, numeric) to anon, authenticated, service_role;

-- ── 5. How far out does the furthest crew reach? ────────────────────────────
-- Lets the booking flow tell a customer something true ("we serve up to N km
-- from <city>") instead of a bare refusal, and lets admin see coverage.
create or replace function max_crew_reach_km(p_lat numeric, p_lng numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select min(gap) from (
    select movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng)
           - coalesce(pt.service_radius_km, 60) as gap
      from partner_teams pt
      join cities c on c.id = pt.primary_city_id
     where pt.onboarding_status = 'verified' and c.is_active
    union all
    select movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng)
           - coalesce(co.service_radius_km, 60)
      from companies co
      join cities c on c.id = co.primary_city_id
     where co.onboarding_status = 'verified' and c.is_active
  ) s;
$$;

grant execute on function max_crew_reach_km(numeric, numeric) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
