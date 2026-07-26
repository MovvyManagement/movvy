-- =============================================================================
-- Movvy — Migration 0067: pricing-gated org job feed (Stage 2 of the merge)
--
-- In the merged model everyone in an org can SEE the open-job pool (so crew
-- aren't in the dark), but only ADMINS see the money. Enforcing that in the UI
-- alone isn't enough — a crew member could read the dollar columns straight off
-- the API. So the gate lives in the data layer: this feed returns the dollar
-- columns ONLY when is_org_admin() (migration 0066) is true, and NULL otherwise.
--
-- Additive: this is a NEW function alongside the legacy open_jobs_for_me (which
-- returns `setof bookings`, prices and all). The current installed app keeps
-- using the old one until the merged app ships in the rebuild; the new app
-- reads org_open_jobs() so crew never receive pricing over the wire.
--
-- Visibility (which jobs) is unchanged from open_jobs_for_me: the unassigned
-- 'searching' pool within p_radius_km of the caller's org base city.
-- =============================================================================

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
  -- MONEY — populated only for org admins; NULL for crew.
  price_total_cents               int,
  driver_total_cents              int
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
    case when is_org_admin() then b.driver_total_cents else null end
  from bookings b
  where b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9) <= p_radius_km
  order by b.scheduled_for_window_starts_at asc nulls last;
$$;

revoke all on function org_open_jobs(numeric) from public;
grant execute on function org_open_jobs(numeric) to authenticated, service_role;
