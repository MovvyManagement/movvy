-- =============================================================================
-- 0096 — Crew can see open jobs, and a dispatcher's ping can actually send.
--
-- TWO SEPARATE BUGS, both "the UI offers something the database refuses".
--
-- 1. THE CREW JOB FEED WAS STRUCTURALLY EMPTY.
--    my_partner_distance_km (0052) only counted a company membership when
--    `cm.role in ('owner','dispatcher')`. Crew are inserted as role='driver'
--    (0073), so for any crew member the min() ran over an empty set and returned
--    NULL. All three consumers coalesce NULL to 1e9 and compare against a 60 km
--    radius, so all three excluded crew outright:
--       · org_open_jobs      → zero rows
--       · open_jobs_for_me   → zero rows
--       · RLS bookings_open_pool_select → crew can't even read an open booking
--    Meanwhile the app renders CrewOpenJobs for exactly those users, and 0088's
--    whole premise is "register with no truck, join a crew that has one, then
--    accept". The distance gate contradicted both, silently — an empty list with
--    no error is impossible to debug from.
--
--    The radius is the product rule (a crew only sees work within 60 km of their
--    HQ, which is why 0.5h travel to pickup is right everywhere). Membership is
--    what should decide whose HQ to measure from — not seniority within the org.
--
-- 2. THE DISPATCHER CAPACITY PING COULD NEVER SEND.
--    `notifications` has RLS enabled with SELECT and UPDATE policies and NO
--    INSERT policy (0005_rls.sql:438-442), so a client-side insert is denied
--    however the grants read. useDispatcherPing writes directly from the app, so
--    tapping Send surfaced "new row violates row-level security policy" and the
--    crew never heard about the capacity check.
--
--    Edge functions use the service role and bypass RLS, which is why every
--    other notification path works and this one didn't. The policy below is
--    deliberately narrow: you may notify someone who shares an org with you,
--    and nobody else. Broad insert rights on this table would let any account
--    push arbitrary text into any user's inbox.
-- =============================================================================

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
       -- Any active member, admin or crew. Seniority decides what you may DO
       -- with a job (accept, assign, see the money), never whether the job is
       -- within reach of your crew's HQ.
  );
$$;

grant execute on function my_partner_distance_km(numeric, numeric) to authenticated, service_role;

-- can_browse_open_jobs carried the identical stale clause. Nothing calls it
-- today, but leaving a second contradictory definition of "can this partner see
-- work" around is how this bug happened in the first place.
create or replace function can_browse_open_jobs()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from partner_team_members ptm
     where ptm.profile_id = auth.uid()
       and ptm.status = 'active'
       and ptm.removed_at is null
    union all
    select 1 from company_members cm
     where cm.profile_id = auth.uid()
       and cm.status = 'active'
       and cm.removed_at is null
  );
$$;

grant execute on function can_browse_open_jobs() to authenticated, service_role;

-- ── Notifications: a narrow INSERT policy ───────────────────────────────────
drop policy if exists notifications_insert_same_org on notifications;
create policy notifications_insert_same_org on notifications for insert
  with check (
    -- Yourself, always.
    profile_id = auth.uid()
    -- Or someone on an org you're also an active member of.
    or exists (
      select 1
        from company_members me
        join company_members them on them.company_id = me.company_id
       where me.profile_id = auth.uid()
         and me.status = 'active' and me.removed_at is null
         and them.profile_id = notifications.profile_id
         and them.status = 'active' and them.removed_at is null
    )
    or is_admin()
  );
