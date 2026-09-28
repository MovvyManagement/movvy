-- =============================================================================
-- Migration 0121 — a decline actually removes the job from that company's pool
--
-- bookings-dispatch-decline's "searching" branch only wrote an audit line, so a
-- company that passed on an open job kept seeing it in every feed refresh. This
-- makes a decline a real signal: the job disappears from the declining
-- company's open pool and stays gone, while every other in-range company still
-- sees it.
--
-- Recorded per (booking, company). The open-pool feeds are all SECURITY DEFINER
-- (they bypass RLS), so the exclusion is added to each feed function directly,
-- plus the RLS read policy for any direct bookings read. booking_declined_by_me
-- is itself SECURITY DEFINER so it can read the ledger from inside a policy.
-- =============================================================================

create table if not exists dispatch_declines (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Who pressed Dismiss (an org owner/dispatcher).
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (booking_id, company_id)
);

create index if not exists dispatch_declines_company_idx
  on dispatch_declines (company_id, created_at desc);
create index if not exists dispatch_declines_booking_idx
  on dispatch_declines (booking_id);

alter table dispatch_declines enable row level security;

-- Admins can see their org's declines; Movvy admins see all. Writes are
-- service-role only (the edge function records them) — a client that could
-- write this table could hide jobs from other companies.
create policy dispatch_declines_org_read on dispatch_declines for select
  using (is_company_admin(company_id) or is_admin());

grant select on dispatch_declines to authenticated;
grant all on dispatch_declines to service_role;

-- Has any company the caller actively belongs to declined this booking?
-- SECURITY DEFINER so it can be used inside an RLS policy and the definer feeds.
create or replace function booking_declined_by_me(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from dispatch_declines dd
      join company_members cm on cm.company_id = dd.company_id
     where dd.booking_id = p_booking_id
       and cm.profile_id = auth.uid()
       and cm.status = 'active'
       and cm.removed_at is null
  );
$$;

grant execute on function booking_declined_by_me(uuid) to authenticated, service_role;

-- ── dispatch_queue: hide declined jobs from the admin's Requests board ───────
-- Same body as 0085; the only change is the extra NOT EXISTS on the
-- 'new_request' (searching) query. 'needs_driver' is this org's already-accepted
-- work, which a decline never touched, so it's left alone.
drop function if exists dispatch_queue(uuid);

create or replace function dispatch_queue(p_company_id uuid)
returns table (
  id uuid,
  short_code text,
  status booking_status,
  move_type move_type,
  pickup_line1 text,
  pickup_city text,
  pickup_lat numeric,
  pickup_lng numeric,
  dropoff_line1 text,
  dropoff_city text,
  scheduled_for_date date,
  scheduled_for_window text,
  scheduled_for_window_starts_at timestamptz,
  price_total_cents int,
  customer_id uuid,
  assigned_driver_profile_id uuid,
  dispatch_accepted_at timestamptz,
  created_at timestamptz,
  bucket text,
  required_truck_ft int,
  required_crew int,
  bedrooms int,
  dwelling text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text;
  v_lat numeric;
  v_lng numeric;
begin
  select my_company_role(p_company_id) into v_role;
  if v_role not in ('owner', 'dispatcher') then return; end if;

  select c.center_lat, c.center_lng into v_lat, v_lng
    from companies co
    join cities c on c.id = co.primary_city_id
   where co.id = p_company_id;

  return query
    select b.id, b.short_code, b.status, b.move_type,
           b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
           b.dropoff_line1, b.dropoff_city,
           b.scheduled_for_date, b.scheduled_for_window, b.scheduled_for_window_starts_at,
           b.price_total_cents, b.customer_id,
           b.assigned_driver_profile_id, b.dispatch_accepted_at, b.created_at,
           'new_request'::text as bucket,
           required_truck_ft(b.id),
           movvy_required_crew(b.id),
           coalesce((b.details->>'bedrooms')::int, 0),
           coalesce(b.details->>'dwelling', '')
    from bookings b
    where b.status = 'searching'
      and b.assigned_company_id is null
      and b.assigned_team_id is null
      and b.assigned_driver_profile_id is null
      and v_lat is not null
      and movvy_km_between(b.pickup_lat, b.pickup_lng, v_lat, v_lng) <= 60
      and not exists (
        select 1 from dispatch_declines dd
         where dd.booking_id = b.id and dd.company_id = p_company_id
      );

  return query
    select b.id, b.short_code, b.status, b.move_type,
           b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
           b.dropoff_line1, b.dropoff_city,
           b.scheduled_for_date, b.scheduled_for_window, b.scheduled_for_window_starts_at,
           b.price_total_cents, b.customer_id,
           b.assigned_driver_profile_id, b.dispatch_accepted_at, b.created_at,
           'needs_driver'::text as bucket,
           required_truck_ft(b.id),
           movvy_required_crew(b.id),
           coalesce((b.details->>'bedrooms')::int, 0),
           coalesce(b.details->>'dwelling', '')
    from bookings b
    where b.status = 'assigned'
      and b.assigned_company_id = p_company_id
      and b.assigned_driver_profile_id is null;
end;
$$;

grant execute on function dispatch_queue(uuid) to authenticated, service_role;

-- ── org_open_jobs: same exclusion (the pricing-gated member feed) ────────────
create or replace function org_open_jobs(p_radius_km numeric default 60)
returns table (
  id                              uuid,
  short_code                      text,
  status                          booking_status,
  move_type                       move_type,
  pickup_line1                    text,
  pickup_city                     text,
  pickup_lat                      numeric,
  pickup_lng                      numeric,
  dropoff_line1                   text,
  dropoff_city                    text,
  dropoff_lat                     numeric,
  dropoff_lng                     numeric,
  scheduled_for_date              date,
  scheduled_for_window            text,
  scheduled_for_window_starts_at  timestamptz,
  customer_id                     uuid,
  distance_km                     numeric,
  price_total_cents               int,
  driver_total_cents              int,
  required_truck_ft               int,
  required_crew                   int,
  my_max_truck_ft                 int,
  bedrooms                        int,
  dwelling                        text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    b.id, b.short_code, b.status, b.move_type,
    b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
    b.dropoff_line1, b.dropoff_city, b.dropoff_lat, b.dropoff_lng,
    b.scheduled_for_date, b.scheduled_for_window, b.scheduled_for_window_starts_at,
    b.customer_id,
    round(coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 0), 1) as distance_km,
    case when is_org_admin() then b.price_total_cents  else null end,
    case when is_org_admin() then b.driver_total_cents else null end,
    required_truck_ft(b.id),
    movvy_required_crew(b.id),
    coalesce(
      (select org_max_truck_ft(cm.company_id)
         from company_members cm
        where cm.profile_id = auth.uid()
          and cm.status = 'active'
          and cm.removed_at is null
        order by cm.org_role = 'crew' desc
        limit 1),
      0
    ),
    coalesce((b.details->>'bedrooms')::int, 0),
    coalesce(b.details->>'dwelling', '')
  from bookings b
  where b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9) <= p_radius_km
    and not booking_declined_by_me(b.id)
  order by b.scheduled_for_window_starts_at asc nulls last;
$$;

grant execute on function org_open_jobs(numeric) to authenticated, service_role;

-- ── open_jobs_for_me: same exclusion (0102's distance-based setof feed) ──────
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
    and not booking_declined_by_me(b.id)
  order by b.scheduled_for_date asc, b.created_at asc;
$$;

grant execute on function open_jobs_for_me(numeric) to authenticated, service_role;

-- ── RLS read policy: hide declined jobs from direct bookings reads too ───────
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
    and not booking_declined_by_me(id)
  );

notify pgrst, 'reload schema';
