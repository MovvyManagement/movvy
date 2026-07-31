-- =============================================================================
-- 0071 — Turn on Google road routing for the in-app map.
--
-- The `directions` edge function (road-following polyline) and the pricing
-- engine's routes-distance both gate on feature_flags.google_routes_enabled +
-- the google_routes budget. The flag shipped default-OFF. Flip it on so the map
-- draws street-following routes (pickup→dropoff preview, the company/driver job
-- cards, and the live driver→target line) instead of a straight segment.
--
-- REQUIRES the "Routes API" to be enabled on the Google Cloud project the
-- GOOGLE_MAPS_SERVER_KEY belongs to. If it isn't, every call returns
-- REQUEST_DENIED and the client simply keeps the straight-line fallback — no
-- breakage, just no road route until the API is switched on.
-- =============================================================================

update feature_flags set enabled = true where key = 'google_routes_enabled';

-- Make sure the budget row exists (idempotent — 0027 already seeds it).
insert into api_budgets (service, daily_cap_usd, monthly_cap_usd)
values ('google_routes', 5.00, 100.00)
on conflict (service) do nothing;
