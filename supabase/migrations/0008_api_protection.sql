-- =============================================================================
-- Movvy — Migration 0008: API cost protection
-- Defenses against runaway spend on Google Maps (and any future paid API).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FEATURE FLAGS
-- Per-service kill switches. Admin can flip these to instantly halt outbound
-- calls to paid APIs (and the edge function will fall back to free providers).
-- -----------------------------------------------------------------------------

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Seed the flags we care about — all DISABLED by default.
-- Admin must explicitly enable to spend money.
insert into feature_flags (key, enabled, description) values
  ('google_places_enabled',    false, 'Use Google Places autocomplete instead of free Nominatim'),
  ('google_directions_enabled', false, 'Use Google Directions API for route + ETA'),
  ('google_distance_matrix_enabled', false, 'Use Google Distance Matrix for pricing'),
  ('stripe_live_enabled',       false, 'Charge real cards (vs test mode)'),
  ('expo_push_enabled',         false, 'Send push notifications'),
  ('twilio_sms_enabled',        false, 'Send SMS via Twilio'),
  ('checkr_enabled',            false, 'Run background checks via Checkr')
on conflict (key) do nothing;

alter table feature_flags enable row level security;
create policy ff_admin_read on feature_flags for select using (is_admin());
create policy ff_admin_write on feature_flags for all using (is_full_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- API BUDGETS
-- Daily / monthly spend caps per service. When today's spend hits the cap,
-- the proxy edge function refuses paid calls and falls back to free providers.
-- -----------------------------------------------------------------------------

create table api_budgets (
  service text primary key,
  daily_cap_usd numeric(10,2) not null,
  monthly_cap_usd numeric(10,2) not null,
  alert_threshold_pct numeric(5,2) not null default 80,  -- send admin notification at 80%
  hard_stop boolean not null default true,                -- true = block when over cap
  updated_at timestamptz not null default now()
);

-- Conservative starting budgets — admin must raise via dashboard before scaling
insert into api_budgets (service, daily_cap_usd, monthly_cap_usd) values
  ('google_places',          5.00,   100.00),
  ('google_directions',      5.00,   100.00),
  ('google_distance_matrix', 5.00,   100.00),
  ('google_geocoding',       3.00,    50.00),
  ('stripe',                999.99, 99999.99),    -- Stripe doesn't bill per API call, leave high
  ('twilio',                 5.00,    50.00),
  ('checkr',                10.00,   200.00)
on conflict (service) do nothing;

alter table api_budgets enable row level security;
create policy budget_admin on api_budgets for all using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- API SPEND LOG
-- Every paid-API call is logged with its estimated cost. Aggregated per day.
-- -----------------------------------------------------------------------------

create table api_spend_log (
  id bigserial primary key,
  service text not null,
  endpoint text,                            -- e.g. 'autocomplete', 'directions'
  profile_id uuid references profiles(id) on delete set null,
  ip_address inet,
  cost_usd numeric(10,5) not null,          -- per-call cost in USD
  cache_hit boolean not null default false, -- if true, cost should be 0
  status_code int,
  request_id text,                          -- third-party request id for support
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index spend_log_service_day_idx on api_spend_log (service, created_at desc);
create index spend_log_profile_idx on api_spend_log (profile_id, created_at desc);

alter table api_spend_log enable row level security;
create policy spend_admin_read on api_spend_log for select using (is_admin());
-- No INSERT policy = only service role can write (from edge functions)

-- -----------------------------------------------------------------------------
-- API CACHE
-- 1-hour cache for autocomplete + 24h cache for place details / geocoding.
-- Same query in the cache window = 0 Google calls.
-- -----------------------------------------------------------------------------

create table api_cache (
  cache_key text primary key,                -- sha256(service + ':' + query)
  service text not null,
  query_hash text not null,                  -- truncated for debugging
  response jsonb not null,
  hit_count int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index api_cache_expires_idx on api_cache (expires_at);

alter table api_cache enable row level security;
-- No user-facing policies — service role only

-- -----------------------------------------------------------------------------
-- HELPER: check budget + decide if we're allowed to spend
-- Returns: jsonb { allowed: bool, reason: string, today_usd: number, cap_usd: number }
-- -----------------------------------------------------------------------------

create or replace function api_budget_check(
  p_service text,
  p_est_cost_usd numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget api_budgets;
  v_flag feature_flags;
  v_today_usd numeric;
  v_pct numeric;
begin
  -- Feature flag check first
  select * into v_flag from feature_flags where key = (p_service || '_enabled');
  if found and not v_flag.enabled then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'feature_flag_disabled',
      'service', p_service
    );
  end if;

  select * into v_budget from api_budgets where service = p_service;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_budget_configured');
  end if;

  -- Compute today's spend so far
  select coalesce(sum(cost_usd), 0) into v_today_usd
  from api_spend_log
  where service = p_service
    and created_at >= date_trunc('day', now());

  if v_budget.hard_stop and (v_today_usd + coalesce(p_est_cost_usd, 0)) > v_budget.daily_cap_usd then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_cap_exceeded',
      'today_usd', v_today_usd,
      'cap_usd', v_budget.daily_cap_usd
    );
  end if;

  v_pct := (v_today_usd / v_budget.daily_cap_usd) * 100;

  return jsonb_build_object(
    'allowed', true,
    'today_usd', v_today_usd,
    'cap_usd', v_budget.daily_cap_usd,
    'pct_used', v_pct,
    'alert', v_pct >= v_budget.alert_threshold_pct
  );
end $$;

-- -----------------------------------------------------------------------------
-- HELPER: log a call. Called by edge functions after a paid request returns.
-- -----------------------------------------------------------------------------

create or replace function api_log_call(
  p_service text,
  p_endpoint text,
  p_profile_id uuid,
  p_ip text,
  p_cost_usd numeric,
  p_cache_hit boolean default false,
  p_status int default 200,
  p_metadata jsonb default null
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into api_spend_log
    (service, endpoint, profile_id, ip_address, cost_usd, cache_hit, status_code, metadata)
  values
    (p_service, p_endpoint, p_profile_id, p_ip::inet, p_cost_usd, p_cache_hit, p_status, p_metadata);
$$;

-- -----------------------------------------------------------------------------
-- HELPER: cache get + set
-- -----------------------------------------------------------------------------

create or replace function api_cache_get(p_key text)
returns jsonb language sql as $$
  update api_cache
    set hit_count = hit_count + 1
    where cache_key = p_key and expires_at > now()
    returning response;
$$;

create or replace function api_cache_set(
  p_key text,
  p_service text,
  p_query_hash text,
  p_response jsonb,
  p_ttl_seconds int
) returns void language sql as $$
  insert into api_cache (cache_key, service, query_hash, response, expires_at)
  values (p_key, p_service, p_query_hash, p_response, now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (cache_key) do update
    set response = excluded.response,
        expires_at = excluded.expires_at;
$$;

-- -----------------------------------------------------------------------------
-- Periodic cleanup of expired cache entries (run via cron later)
-- -----------------------------------------------------------------------------

create or replace function api_cache_prune()
returns int language sql as $$
  with deleted as (
    delete from api_cache where expires_at < now() - interval '1 day' returning 1
  )
  select count(*) from deleted;
$$;
