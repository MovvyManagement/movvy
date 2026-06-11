-- =============================================================================
-- Movvy — Migration 0021: Public review feed per crew
--
-- Customer-to-partner ratings (overall + comment + tags) become publicly
-- readable when they reference a team or company. The customer's identity
-- stays hidden — only `display_name` (first name + last initial) is exposed.
--
-- Used by:
--   • the booking-confirm screen — preview crew before committing
--   • the partner profile screen — drivers see what customers say
--   • marketing surfaces (later)
-- =============================================================================

-- A SECURITY DEFINER function that returns the public-safe slice of
-- ratings. We expose it instead of opening RLS on the table itself so we
-- can rigidly control what's readable.
create or replace function public_reviews_for_team(p_team_id uuid, p_limit int default 20)
returns table (
  rating_id uuid,
  overall smallint,
  comment text,
  tags text[],
  created_at timestamptz,
  reviewer_display text  -- e.g. "Adam H."
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         r.overall,
         r.comment,
         r.tags,
         r.created_at,
         coalesce(
           split_part(p.full_name, ' ', 1)
             || ' '
             || left(coalesce(split_part(p.full_name, ' ', 2), ''), 1)
             || '.',
           'Customer'
         ) as reviewer_display
  from ratings r
  join profiles p on p.id = r.from_profile_id
  where r.to_team_id = p_team_id
    and r.party = 'customer_to_partner'
    and r.overall is not null
    and (r.comment is not null or coalesce(array_length(r.tags, 1), 0) > 0 or r.overall <= 3)
  order by r.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public_reviews_for_company(p_company_id uuid, p_limit int default 20)
returns table (
  rating_id uuid,
  overall smallint,
  comment text,
  tags text[],
  created_at timestamptz,
  reviewer_display text
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         r.overall,
         r.comment,
         r.tags,
         r.created_at,
         coalesce(
           split_part(p.full_name, ' ', 1)
             || ' '
             || left(coalesce(split_part(p.full_name, ' ', 2), ''), 1)
             || '.',
           'Customer'
         ) as reviewer_display
  from ratings r
  join profiles p on p.id = r.from_profile_id
  where r.to_company_id = p_company_id
    and r.party = 'customer_to_partner'
    and r.overall is not null
    and (r.comment is not null or coalesce(array_length(r.tags, 1), 0) > 0 or r.overall <= 3)
  order by r.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public_reviews_for_team(uuid, int) from public;
revoke all on function public_reviews_for_company(uuid, int) from public;
grant execute on function public_reviews_for_team(uuid, int) to authenticated, anon;
grant execute on function public_reviews_for_company(uuid, int) to authenticated, anon;
