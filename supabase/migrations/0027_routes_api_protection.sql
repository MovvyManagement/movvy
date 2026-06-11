-- =============================================================================
-- Movvy — Migration 0027: routes-distance feature flag + budget
--
-- Adds the cost-protection rows for the new `routes-distance` edge function.
-- Default-OFF feature flag + $5/day budget — same posture as the other paid
-- Google services. Run `update feature_flags set enabled = true where key =
-- 'google_routes_enabled'` (and confirm the budget is sized for your traffic)
-- before bookings-create starts calling it.
-- =============================================================================

insert into feature_flags (key, enabled, description) values
  ('google_routes_enabled', false,
    'Use Google Routes API (computeRoutes) for distance/duration. Falls back to haversine × 1.30 / 80 kph when off.')
on conflict (key) do nothing;

insert into api_budgets (service, daily_cap_usd, monthly_cap_usd) values
  ('google_routes', 5.00, 100.00)
on conflict (service) do nothing;
