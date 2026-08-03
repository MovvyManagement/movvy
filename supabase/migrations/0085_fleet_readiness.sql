-- =============================================================================
-- 0085 — One call that tells a partner whether they can accept jobs at all.
--
-- The crew jobs feed reads open_jobs_for_me() (setof bookings), NOT the newer
-- org_open_jobs(), so the capacity columns added in 0083 never reached the app:
-- required_truck_ft/my_max_truck_ft arrived undefined, the client-side size
-- check silently no-op'd, and the driver only found out at the server — as a
-- raw "non-2xx". Rather than fork the feed, the app now derives what a move
-- needs from its own details (src/lib/truckFit.ts, same matrix as 0082) and
-- asks for the ONE thing it can't derive: what the org actually owns.
--
-- Returns truck count, biggest box, and the review state of the registration +
-- insurance so the app can say exactly what's missing before the tap.
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
  order by cm.org_role = 'admin' desc
  limit 1;

  if v_company_id is null then
    return jsonb_build_object(
      'company_id', null, 'truck_count', 0, 'max_truck_ft', 0,
      'registration', jsonb_build_object('status', 'missing'),
      'insurance', jsonb_build_object('status', 'missing')
    );
  end if;

  select count(*), coalesce(max(coalesce(length_ft, 0)), 0)
    into v_trucks, v_max_ft
  from vehicles where company_id = v_company_id;

  -- Most relevant document per kind: an approved one wins, else the newest.
  -- Docs can hang off the org OR off an admin's own profile (operator signups
  -- upload before the org row exists), so both are in scope.
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
    'insurance', coalesce(v_ins, jsonb_build_object('status', 'missing'))
  );
end $$;

grant execute on function my_fleet_readiness() to authenticated;

-- ── Crew size, matching the customer's quote exactly ────────────────────────
-- The customer booked "a 3-person crew" and paid the 3-crew rate, so the
-- partner has to see 3 — not a number derived from truck length. Mirrors
-- lookupResidential() in src/lib/pricing.ts (and requiredCrew in truckFit.ts).
create or replace function movvy_required_crew(p_booking_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select case
    -- Commercial / labour-only carry an explicit crew size from the booking flow.
    when coalesce((b.details->>'crewSize')::int, 0) > 0 then (b.details->>'crewSize')::int
    when b.move_type <> 'home_move' then 2
    when coalesce(b.details->>'dwelling', '') in ('house', 'townhouse') then
      case
        when coalesce((b.details->>'bedrooms')::int, 0) <= 2 then 2
        when coalesce((b.details->>'bedrooms')::int, 0) <= 4 then 3
        else 4
      end
    else
      case when coalesce((b.details->>'bedrooms')::int, 0) <= 2 then 2 else 3 end
  end
  from bookings b where b.id = p_booking_id;
$$;

grant execute on function movvy_required_crew(uuid) to authenticated, service_role;

-- org_open_jobs (0083) computed crew from truck length — same drift. Repoint it
-- at the shared function so every surface shows one number.
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
  order by b.scheduled_for_window_starts_at asc nulls last;
$$;

grant execute on function org_open_jobs(numeric) to authenticated, service_role;

-- ── The admin's Requests board needs the same capacity signal ────────────────
-- dispatch_queue() feeds the "Requests" tab an ADMIN accepts from, and it
-- carried no move-size data at all — so the crew-size line and the truck-fit
-- check were both flying blind there. Same two computed columns as 0083.
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
  bucket text, -- 'new_request' | 'needs_driver'
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
      and movvy_km_between(b.pickup_lat, b.pickup_lng, v_lat, v_lng) <= 60;

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
