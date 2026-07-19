-- =============================================================================
-- Movvy — Migration 0065: missing write grants for client-written tables
--
-- Migration 0011 grants insert/update/delete to `authenticated` on an EXPLICIT
-- list of tables. Its `alter default privileges` line only covers SELECT, so
-- every table created after 0011 that the client writes to has been readable
-- but not writable — failing at runtime with:
--     42501  permission denied for table <name>
--
-- Found 2026-07-18 when the customer Add-card screen failed after the
-- payment_methods table was restored by 0064: the table and its RLS policies
-- existed, but `authenticated` had no INSERT privilege, so the insert was
-- rejected before RLS was ever consulted.
--
-- SECURITY: these grants only allow the role to ATTEMPT access — row-level
-- security still decides which rows are visible/writable. Each table below was
-- verified to have restrictive RLS before being included:
--   payment_methods           owner-only (profile_id = auth.uid()) + admin
--   driver_availability_blocks owner-only (driver_profile_id = auth.uid())
--   referrals                 insert gated to referred_profile_id = auth.uid()
--   feature_flags             writes gated to is_full_admin()
--   api_budgets               writes gated to is_full_admin()
-- =============================================================================

grant insert, update, delete on payment_methods            to authenticated;
grant insert, update, delete on driver_availability_blocks to authenticated;
grant insert, update, delete on referrals                  to authenticated;
grant insert, update, delete on feature_flags              to authenticated;
grant insert, update, delete on api_budgets                to authenticated;

-- Guard against this recurring: any FUTURE table created in `public` now
-- inherits write privileges too. RLS remains the gate that actually protects
-- rows — a new table with RLS enabled and no policies is still fully locked.
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;
