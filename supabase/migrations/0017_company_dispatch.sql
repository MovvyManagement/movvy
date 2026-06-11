-- =============================================================================
-- Movvy — Migration 0017: Company dispatch (two-step flow)
--
-- Companies (vs. 2-person teams) operate on a dispatcher-first model:
--   step 1) Dispatcher accepts a `searching` booking on behalf of the company
--             → status='assigned', assigned_company_id set, driver_id NULL,
--               dispatch_accepted_at = now()
--   step 2) Dispatcher assigns one of the company's drivers
--             → assigned_driver_profile_id set, assigned_at = now()
--   step 3) Driver flows through normal status updates (on_the_way, ...)
--
-- Drivers under a company can NEVER call bookings-accept — the edge function
-- rejects them. They only progress jobs that the dispatcher hands them.
--
-- Solo 2-person teams keep the single-step accept (driver = the team person).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. dispatch_accepted_at column on bookings
-- -----------------------------------------------------------------------------
-- Distinct from `assigned_at` so we can measure dispatcher latency (how long
-- a booking sat in the company queue before a driver was actually picked).

alter table bookings
  add column dispatch_accepted_at timestamptz;

create index bookings_dispatch_queue_idx
  on bookings (assigned_company_id, status)
  where status = 'assigned' and assigned_driver_profile_id is null;

-- Sanity check: if assigned_driver_profile_id is set without
-- dispatch_accepted_at, treat it as an instant single-step accept (a
-- solo-team flow) — we backfill so analytics make sense.
update bookings
  set dispatch_accepted_at = assigned_at
  where assigned_driver_profile_id is not null
    and assigned_at is not null
    and dispatch_accepted_at is null;

-- -----------------------------------------------------------------------------
-- 2. Helper: my_company_role(p_company_id) — owner | dispatcher | driver | null
-- -----------------------------------------------------------------------------
-- Returns the caller's role inside the given company, or null if not a member.
-- Used by edge functions to gate dispatch actions.

create or replace function my_company_role(p_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role::text
  from company_members
  where company_id = p_company_id
    and profile_id = auth.uid()
    and removed_at is null
  limit 1;
$$;

revoke all on function my_company_role(uuid) from public;
grant execute on function my_company_role(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. is_company_driver — used by edge functions to block solo-accept by
--    a company driver who should be waiting for dispatch.
-- -----------------------------------------------------------------------------

create or replace function my_company_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select company_id
  from company_members
  where profile_id = auth.uid()
    and removed_at is null
  limit 1;
$$;

revoke all on function my_company_id() from public;
grant execute on function my_company_id() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Dispatcher view of pending queue
-- -----------------------------------------------------------------------------
-- Bookings the dispatcher needs to act on for their company:
--   (a) 'searching' in the company's service city  (NEW REQUESTS)
--   (b) 'assigned' to my company with no driver yet (NEEDS DRIVER)
-- We expose this via a SECURITY DEFINER function so dispatchers don't need
-- direct row access to 'searching' bookings outside their company.

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
  price_total_cents int,
  customer_id uuid,
  assigned_driver_profile_id uuid,
  dispatch_accepted_at timestamptz,
  created_at timestamptz,
  bucket text -- 'new_request' | 'needs_driver'
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text;
  v_city_id uuid;
begin
  -- Caller must be an owner or dispatcher for the company
  select my_company_role(p_company_id) into v_role;
  if v_role not in ('owner', 'dispatcher') then
    return; -- empty result
  end if;

  select primary_city_id into v_city_id from companies where id = p_company_id;

  -- (a) new requests in the company's city — only 'searching'
  return query
    select b.id, b.short_code, b.status, b.move_type,
           b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
           b.dropoff_line1, b.dropoff_city,
           b.scheduled_for_date, b.scheduled_for_window,
           b.price_total_cents, b.customer_id,
           b.assigned_driver_profile_id, b.dispatch_accepted_at, b.created_at,
           'new_request'::text as bucket
    from bookings b
    where b.status = 'searching'
      and b.city_id = v_city_id;

  -- (b) accepted by my company, waiting for driver assignment
  return query
    select b.id, b.short_code, b.status, b.move_type,
           b.pickup_line1, b.pickup_city, b.pickup_lat, b.pickup_lng,
           b.dropoff_line1, b.dropoff_city,
           b.scheduled_for_date, b.scheduled_for_window,
           b.price_total_cents, b.customer_id,
           b.assigned_driver_profile_id, b.dispatch_accepted_at, b.created_at,
           'needs_driver'::text as bucket
    from bookings b
    where b.status = 'assigned'
      and b.assigned_company_id = p_company_id
      and b.assigned_driver_profile_id is null;
end;
$$;

revoke all on function dispatch_queue(uuid) from public;
grant execute on function dispatch_queue(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Driver roster helper — used by the dispatcher "Assign driver" picker
-- -----------------------------------------------------------------------------
-- Lists every active driver in the company along with how many in-flight
-- bookings they're currently on (so dispatcher can pick who's free).

create or replace function company_drivers_roster(p_company_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext,
  phone text,
  driver_license_number text,
  active_jobs int
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
           ), 0) as active_jobs
    from company_members cm
    join profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id
      and cm.role = 'driver'
      and cm.removed_at is null
      and p.deleted_at is null
    order by p.full_name;
end;
$$;

revoke all on function company_drivers_roster(uuid) from public;
grant execute on function company_drivers_roster(uuid) to authenticated;
