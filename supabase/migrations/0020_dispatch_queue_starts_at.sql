-- =============================================================================
-- Movvy — Migration 0020: Expose scheduled_for_window_starts_at on
-- dispatch_queue so the UI can compute precise "Starts in 47m" urgency pills.
--
-- Pure RPC rewrite — no schema changes. The dispatch.tsx Needs-driver
-- cards show a red pill when the booking is within 6h of starting or has
-- already passed without an assigned driver.
-- =============================================================================

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
  v_city_id uuid;
begin
  select my_company_role(p_company_id) into v_role;
  if v_role not in ('owner', 'dispatcher') then return; end if;

  select primary_city_id into v_city_id from companies where id = p_company_id;

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
      and b.city_id = v_city_id;

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
