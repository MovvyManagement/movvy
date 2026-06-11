-- =============================================================================
-- Movvy — Migration 0038: Proximity-based open-job matching (60 km radius)
--
-- Problem (observed in prod): a customer booking is assigned a single city_id
-- by bookings-create — the nearest active city to the pickup. But partners are
-- scoped to exactly ONE primary_city_id, and every read path matched jobs to
-- partners by EXACT city equality:
--   • driver/mover feed  — useAvailableJobs: bookings WHERE city_id = my city
--   • open-pool RLS      — can_browse_open_jobs: my primary_city_id = booking city
--   • company dispatch   — dispatch_queue new_request: b.city_id = company city
-- So a move whose pickup geocoded to a city with no partners (e.g. a Calgary-
-- labelled address that resolved to Airdrie) was invisible to everyone.
--
-- Fix: match by DISTANCE instead of city equality. A partner sees an open
-- booking when its pickup is within 60 km of their base-city center. Accepting
-- is still gated by can_take_jobs() in the bookings-accept edge function, so
-- this only governs visibility.
-- =============================================================================

-- Generic haversine (km). IMMUTABLE — safe to use in policies + queries.
create or replace function movvy_km_between(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
) returns numeric language sql immutable set search_path = public, pg_temp as $$
  select (2 * 6371 * asin(sqrt(
    power(sin(radians((p_lat2 - p_lat1) / 2)), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians((p_lng2 - p_lng1) / 2)), 2)
  )))::numeric;
$$;

-- Distance (km) from a point to the caller's NEAREST partner base — the center
-- of any team OR company (owner/dispatcher) they belong to. NULL when the
-- caller has no partner membership (pure customer). SECURITY DEFINER so it can
-- read the membership tables without recursing into their RLS.
create or replace function my_partner_distance_km(p_lat numeric, p_lng numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select min(movvy_km_between(p_lat, p_lng, c.center_lat, c.center_lng))
  from cities c
  where c.id in (
    select pt.primary_city_id
      from partner_team_members ptm
      join partner_teams pt on pt.id = ptm.team_id
     where ptm.profile_id = auth.uid() and ptm.removed_at is null
    union
    select co.primary_city_id
      from company_members cm
      join companies co on co.id = cm.company_id
     where cm.profile_id = auth.uid() and cm.removed_at is null
       and cm.role in ('owner', 'dispatcher')
  );
$$;

grant execute on function movvy_km_between(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function my_partner_distance_km(numeric, numeric) to authenticated, service_role;

-- Open-pool visibility now keys off DISTANCE, not exact city. Replaces the
-- exact-city policy from migration 0036. RLS policies are OR-combined, so this
-- still sits alongside the customer / assigned-partner / admin policies.
drop policy if exists bookings_open_pool_select on bookings;
create policy bookings_open_pool_select on bookings for select
  using (
    status = 'searching'
    and assigned_driver_profile_id is null
    and assigned_team_id is null
    and assigned_company_id is null
    and coalesce(my_partner_distance_km(pickup_lat, pickup_lng), 1e9) <= 60
  );

-- Driver/mover feed RPC. SECURITY DEFINER so the list is self-contained; the
-- policy above still governs the single-row read on the job-detail screen.
-- p_radius_km defaults to 60 so the client doesn't have to know the number.
create or replace function open_jobs_for_me(p_radius_km numeric default 60)
returns setof bookings language sql stable security definer set search_path = public, pg_temp as $$
  select b.*
  from bookings b
  where b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9) <= p_radius_km
  order by b.scheduled_for_window_starts_at asc nulls last;
$$;

grant execute on function open_jobs_for_me(numeric) to authenticated, service_role;

-- Company dispatch — new_request bucket now matches by distance from the
-- company's base-city center instead of city_id equality. needs_driver bucket
-- is unchanged (jobs already accepted by THIS company that need a driver).
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
  bucket text -- 'new_request' | 'needs_driver'
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
           'new_request'::text as bucket
    from bookings b
    where b.status = 'searching'
      and b.assigned_company_id is null
      and b.assigned_team_id is null
      and b.assigned_driver_profile_id is null
      and v_lat is not null
      and movvy_km_between(b.pickup_lat, b.pickup_lng, v_lat, v_lng) <= 60;

  return query
    select b.id, b.short_code, b.status, b.move_type,
           b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
           b.dropoff_line1, b.dropoff_city,
           b.scheduled_for_date, b.scheduled_for_window, b.scheduled_for_window_starts_at,
           b.price_total_cents, b.customer_id,
           b.assigned_driver_profile_id, b.dispatch_accepted_at, b.created_at,
           'needs_driver'::text as bucket
    from bookings b
    where b.status = 'assigned'
      and b.assigned_company_id = p_company_id
      and b.assigned_driver_profile_id is null;
end;
$$;
