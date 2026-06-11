-- =============================================================================
-- Movvy — Migration 0004: Audit logs, notifications, rate limits, promos, payouts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AUDIT LOG (append-only)
-- Every sensitive operation is logged. Never updated, never deleted via app.
-- Indexed for fast lookup by actor + entity.
-- -----------------------------------------------------------------------------

create table audit_logs (
  id bigserial primary key,
  actor_profile_id uuid references profiles(id) on delete set null,
  actor_role user_role,
  action text not null,                         -- 'booking.status_changed', 'refund.issued'
  entity_type text not null,                    -- 'booking', 'profile', 'company'
  entity_id uuid,
  ip_address inet,
  user_agent text,
  payload jsonb,                                -- old/new values
  created_at timestamptz not null default now()
);

create index audit_logs_actor_idx on audit_logs (actor_profile_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_action_idx on audit_logs (action, created_at desc);

-- -----------------------------------------------------------------------------
-- RATE LIMITING (DB-backed sliding window)
-- Fast for low-volume. Move to Redis (Upstash) when traffic warrants.
-- -----------------------------------------------------------------------------

create table rate_limit_buckets (
  id bigserial primary key,
  bucket_key text not null,                     -- 'ip:1.2.3.4:auth_signup' or 'user:<uuid>:bookings_create'
  endpoint text not null,
  hit_count int not null default 1,
  window_starts_at timestamptz not null default now(),
  window_ends_at timestamptz not null
);

create unique index rl_bucket_unique on rate_limit_buckets (bucket_key);
create index rl_window_idx on rate_limit_buckets (window_ends_at);

-- Helper: increment a bucket, returns true if under limit, false if exceeded
create or replace function rl_check_and_increment(
  p_bucket_key text,
  p_endpoint text,
  p_limit int,
  p_window_seconds int
) returns boolean language plpgsql as $$
declare
  v_now timestamptz := now();
  v_bucket rate_limit_buckets;
begin
  insert into rate_limit_buckets (bucket_key, endpoint, window_ends_at)
    values (p_bucket_key, p_endpoint, v_now + (p_window_seconds || ' seconds')::interval)
    on conflict (bucket_key) do update
    set hit_count = case
        when rate_limit_buckets.window_ends_at < v_now then 1
        else rate_limit_buckets.hit_count + 1
      end,
      window_starts_at = case
        when rate_limit_buckets.window_ends_at < v_now then v_now
        else rate_limit_buckets.window_starts_at
      end,
      window_ends_at = case
        when rate_limit_buckets.window_ends_at < v_now then v_now + (p_window_seconds || ' seconds')::interval
        else rate_limit_buckets.window_ends_at
      end
    returning * into v_bucket;
  return v_bucket.hit_count <= p_limit;
end $$;

-- -----------------------------------------------------------------------------
-- PROMO CODES
-- -----------------------------------------------------------------------------

create type promo_kind as enum ('percent_off', 'amount_off_cents', 'free_service_fee');

create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind promo_kind not null,
  value int not null,                           -- percent 1-100, OR cents off
  min_subtotal_cents int default 0,
  max_redemptions int,
  redeemed_count int not null default 0,
  per_user_limit int default 1,
  city_id uuid references cities(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint promo_value_valid check (
    (kind = 'percent_off' and value between 1 and 100) or
    (kind <> 'percent_off' and value >= 0)
  )
);

create index promo_codes_code_idx on promo_codes (code) where is_active;

create table promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  discount_cents int not null,
  created_at timestamptz not null default now()
);

create index promo_red_user_idx on promo_redemptions (promo_code_id, profile_id);

-- Add the FK to bookings now that promo_codes exists
alter table bookings
  add constraint bookings_promo_fk
  foreign key (promo_code_id) references promo_codes(id) on delete set null;

-- -----------------------------------------------------------------------------
-- PAYOUTS
-- Money owed to partners after Movvy commission.
-- -----------------------------------------------------------------------------

create table payouts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references partner_teams(id) on delete restrict,
  company_id uuid references companies(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  gross_cents int not null,
  commission_cents int not null,
  net_cents int not null,
  status payout_status not null default 'pending',
  stripe_transfer_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payouts_one_subject check (
    (team_id is not null)::int + (company_id is not null)::int = 1
  )
);

create index payouts_team_idx on payouts (team_id, period_end);
create index payouts_company_idx on payouts (company_id, period_end);
create index payouts_status_idx on payouts (status);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS (in-app inbox + push delivery log)
-- -----------------------------------------------------------------------------

create type notification_channel as enum ('push', 'email', 'sms', 'in_app');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  channel notification_channel not null,
  category text not null,                       -- 'booking_assigned', 'mover_arrived'
  title text not null,
  body text not null,
  data jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_unread_idx
  on notifications (profile_id, created_at desc) where read_at is null;

create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text not null,                       -- 'ios', 'android', 'web'
  expo_push_token text not null unique,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index device_tokens_profile_idx on device_tokens (profile_id);
