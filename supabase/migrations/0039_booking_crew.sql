-- =============================================================================
-- Movvy — Migration 0039: booking_crew(p_booking_id) — who's moving me?
--
-- The customer Live Move screen (app/(customer)/live.tsx) never showed the
-- customer WHO accepted their job. Once a company or a solo/2-person team
-- accepts a booking, the booking carries assigned_company_id /
-- assigned_team_id (+ assigned_driver_profile_id), but the customer has no
-- direct SELECT on companies / partner_teams / a partner's profile (RLS keeps
-- partner identities private). So the tracker fell back to the anonymous
-- "Your crew" forever.
--
-- This RPC resolves the crew identity the customer is allowed to see — the
-- company's (or team's) public display_name, its rating, verified status, and
-- the assigned driver's name/avatar — and nothing else. It is SECURITY DEFINER
-- so it can read those partner tables, and it is gated hard on
-- `b.customer_id = auth.uid()`: you only ever get the crew for YOUR OWN
-- booking. A booking that isn't yours (or doesn't exist) returns zero rows;
-- a booking not yet assigned returns a row with null display_name, which the
-- client renders as the "Your crew" arranging state.
-- =============================================================================

drop function if exists booking_crew(uuid);

create or replace function booking_crew(p_booking_id uuid)
returns table (
  kind text,                 -- 'company' | 'team' | null (not yet assigned)
  display_name text,         -- company.display_name or team.display_name
  rating_avg numeric,
  rating_count int,
  verified boolean,
  driver_name text,          -- assigned driver's full_name (nullable)
  driver_avatar_url text
) language sql stable security definer set search_path = public, pg_temp as $$
  select
    case
      when b.assigned_company_id is not null then 'company'
      when b.assigned_team_id is not null then 'team'
      else null
    end as kind,
    coalesce(c.display_name, t.display_name) as display_name,
    coalesce(c.rating_avg, t.rating_avg) as rating_avg,
    coalesce(c.rating_count, t.rating_count) as rating_count,
    case
      when b.assigned_company_id is not null then c.verified_at is not null
      when b.assigned_team_id is not null then t.verified_at is not null
      else false
    end as verified,
    d.full_name as driver_name,
    d.avatar_url as driver_avatar_url
  from bookings b
  left join companies c on c.id = b.assigned_company_id
  left join partner_teams t on t.id = b.assigned_team_id
  left join profiles d on d.id = b.assigned_driver_profile_id
  where b.id = p_booking_id
    and b.customer_id = auth.uid();
$$;

revoke all on function booking_crew(uuid) from public;
grant execute on function booking_crew(uuid) to authenticated;
