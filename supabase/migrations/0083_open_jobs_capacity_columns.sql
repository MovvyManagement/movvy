-- =============================================================================
-- 0083 — Surface capacity requirements on the open-jobs feed.
--
-- The feed had no move-size signal at all (no `details`), so a crew couldn't see
-- what truck a job needed and the app couldn't grey out jobs they can't take —
-- they'd only find out at the moment of accepting. This adds the two computed
-- columns the card needs, plus whether the caller's own org actually fits.
-- =============================================================================

drop function if exists org_open_jobs(numeric);

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
  driver_total_cents              int,
  -- CAPACITY — what the job needs vs what the caller's org has.
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
    required_truck_ft(b.id) as required_truck_ft,
    case
      when coalesce((b.details->>'crewSize')::int, 0) > 0
        then (b.details->>'crewSize')::int
      when required_truck_ft(b.id) >= 22 then 3
      else 2
    end as required_crew,
    coalesce(
      (select org_max_truck_ft(cm.company_id)
         from company_members cm
        where cm.profile_id = auth.uid()
          and cm.status = 'active'
          and cm.removed_at is null
        order by cm.org_role = 'crew' desc
        limit 1),
      0
    ) as my_max_truck_ft,
    coalesce((b.details->>'bedrooms')::int, 0) as bedrooms,
    coalesce(b.details->>'dwelling', '') as dwelling
  from bookings b
  where b.status = 'searching'
    and b.assigned_driver_profile_id is null
    and b.assigned_team_id is null
    and b.assigned_company_id is null
    and coalesce(my_partner_distance_km(b.pickup_lat, b.pickup_lng), 1e9) <= p_radius_km
  order by b.scheduled_for_window_starts_at asc nulls last;
$$;

grant execute on function org_open_jobs(numeric) to authenticated;
