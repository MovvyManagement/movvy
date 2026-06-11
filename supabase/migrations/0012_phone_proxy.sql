-- =============================================================================
-- Movvy — Migration 0012: Phone proxy sessions (Twilio-when-ready)
--
-- One row per active booking that pairs customer ↔ driver with a temporary
-- Twilio proxy number. Both parties see the SAME proxy number and Twilio
-- routes calls/SMS to the real number based on session participants.
--
-- Lifecycle:
--   created → active (customer's first dial) → expired (24h after move done)
-- Numbers are returned to a pool when the session expires.
-- =============================================================================

create type proxy_session_status as enum ('pending', 'active', 'expired', 'closed');

create table phone_proxy_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  customer_profile_id uuid not null references profiles(id) on delete cascade,
  driver_profile_id uuid not null references profiles(id) on delete cascade,
  -- Real phone numbers (E.164). Snapshotted so a profile phone change mid-move
  -- doesn't break the active session.
  customer_phone_e164 text not null,
  driver_phone_e164 text not null,
  -- Twilio side
  twilio_proxy_number text,                -- E.164 of the masked number
  twilio_session_sid text,                 -- KCxxxx... from Twilio Proxy API
  -- Lifecycle
  status proxy_session_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pps_phone_format check (
    customer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$' and
    driver_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
  )
);

create index pps_booking_idx on phone_proxy_sessions (booking_id);
create index pps_customer_idx on phone_proxy_sessions (customer_profile_id);
create index pps_driver_idx on phone_proxy_sessions (driver_profile_id);
create index pps_active_idx on phone_proxy_sessions (status) where status in ('pending','active');
create index pps_expiry_idx on phone_proxy_sessions (expires_at) where status in ('pending','active');

alter table phone_proxy_sessions enable row level security;

-- Customer + driver can READ their own session (to see the proxy number to dial)
create policy pps_participant_read on phone_proxy_sessions for select
  using (customer_profile_id = auth.uid() or driver_profile_id = auth.uid() or is_admin());

-- Only service role can write — edge functions handle creation + lifecycle
-- (No INSERT/UPDATE/DELETE policies = no end-user mutations)

create trigger pps_set_updated_at before update on phone_proxy_sessions
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- TWILIO CALL + SMS LOG — append-only record of every routed call/text
-- For billing reconciliation, abuse detection, and audit.
-- -----------------------------------------------------------------------------

create type proxy_event_kind as enum ('call', 'sms');
create type proxy_event_direction as enum ('customer_to_driver', 'driver_to_customer');

create table phone_proxy_events (
  id bigserial primary key,
  session_id uuid not null references phone_proxy_sessions(id) on delete cascade,
  kind proxy_event_kind not null,
  direction proxy_event_direction not null,
  twilio_sid text,                      -- CAxxxx for calls, SMxxxx for SMS
  duration_seconds int,                 -- for calls
  body_preview text,                    -- first 50 chars of SMS (truncated for privacy)
  cost_cents int,                       -- our cost from Twilio (for spend tracking)
  status text,                          -- twilio status: completed, failed, no-answer, etc.
  created_at timestamptz not null default now()
);

create index ppe_session_idx on phone_proxy_events (session_id, created_at desc);

alter table phone_proxy_events enable row level security;
create policy ppe_admin_read on phone_proxy_events for select using (is_admin());
-- No user-facing access — they see the live session, not the historical log.

-- -----------------------------------------------------------------------------
-- TWILIO NUMBER POOL — rented numbers available for assignment
-- -----------------------------------------------------------------------------

create table twilio_number_pool (
  phone_e164 text primary key,
  active_session_id uuid references phone_proxy_sessions(id) on delete set null,
  country_code char(2) not null default 'CA',
  rented_at date not null default current_date,
  monthly_cost_cents int not null default 115,  -- $1.15 USD per CA number
  is_active boolean not null default true,
  last_assigned_at timestamptz,
  notes text
);

create index tnp_available_idx on twilio_number_pool (is_active, active_session_id)
  where is_active and active_session_id is null;

alter table twilio_number_pool enable row level security;
create policy tnp_admin_all on twilio_number_pool for all using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- FEATURE FLAGS — register the Twilio proxy flag (default OFF until configured)
-- -----------------------------------------------------------------------------

insert into feature_flags (key, enabled, description) values
  ('twilio_proxy_enabled', false, 'Enable Twilio-backed customer↔driver phone proxy line')
on conflict (key) do nothing;

insert into api_budgets (service, daily_cap_usd, monthly_cap_usd) values
  ('twilio_proxy', 10.00, 200.00)
on conflict (service) do nothing;
