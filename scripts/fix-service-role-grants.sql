-- =============================================================================
-- One-time fix for "permission denied for table X" errors when running
-- scripts/seed-demo.mjs (and any other server-side script).
--
-- Problem: your migrations were applied by a user other than service_role,
-- so service_role never inherited grants on your tables/sequences. Supabase
-- normally auto-grants when tables are created via the dashboard, but raw
-- SQL migrations don't get that magic.
--
-- HOW TO RUN:
--   1. Open your Supabase dashboard → SQL editor
--   2. Click "New query"
--   3. Paste this entire file
--   4. Click "Run"
--
-- You'll see "Success. No rows returned." Run the seed again afterwards
-- and the permission errors will be gone.
-- =============================================================================

-- 1) Grant service_role full access to every existing table + sequence + fn
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- 2) Make sure tables/sequences/functions created in the FUTURE inherit
--    the same grants automatically (so this never bites you again).
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- 3) Also re-apply the authenticated/anon grants from migration 0011 in
--    case those were partially applied. Idempotent — safe to re-run.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant select on cities to anon;
