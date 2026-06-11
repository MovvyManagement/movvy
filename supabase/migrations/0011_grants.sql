-- =============================================================================
-- Movvy — Migration 0011: Role grants
--
-- Supabase tables don't get default grants for the `anon` / `authenticated`
-- roles when created via raw SQL migrations (only the dashboard auto-grants).
-- RLS already filters rows; these grants just allow the roles to *attempt*
-- access. Without them you get "permission denied for table X".
-- =============================================================================

grant usage on schema public to anon, authenticated;

-- Anonymous users only need to read the city list (RLS still gates the rest).
grant select on cities to anon;

-- Authenticated users can read every table; writes are RLS-gated per policy.
grant select on all tables in schema public to authenticated;

-- Authenticated users perform writes where RLS allows (their own bookings,
-- their own profile, their own saved addresses, etc.).
grant insert, update, delete on
  profiles,
  saved_addresses,
  vehicles,
  companies,
  company_members,
  partner_teams,
  partner_team_members,
  verification_documents,
  bookings,
  ratings,
  disputes,
  chat_threads,
  chat_messages,
  booking_tracking,
  notifications,
  device_tokens
to authenticated;

-- Sequences (for `bigserial` PKs)
grant usage, select on all sequences in schema public to authenticated;

-- Future tables auto-inherit
alter default privileges in schema public
  grant select on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Functions (e.g. helper RPCs called from edge functions are fine — they use
-- service_role. But `api_cache_get` etc. could be called via PostgREST. We
-- restrict to authenticated.)
grant execute on all functions in schema public to authenticated;
