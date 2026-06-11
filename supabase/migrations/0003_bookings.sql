-- =============================================================================
-- Movvy — Migration 0003: Bookings, ratings, disputes, chat
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BOOKINGS
-- One row per customer move request. Status state machine enforced via trigger.
-- Money is stored in CENTS (integer) — never floats — to avoid rounding bugs.
-- -----------------------------------------------------------------------------

create table bookings (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique,            -- 'MV-2032' user-facing reference
  customer_id uuid not null references profiles(id) on delete restrict,
  city_id uuid not null references cities(id),

  move_type move_type not null,
  status booking_status not null default 'draft',

  -- Locations (snapshot — never join to saved_addresses since user may delete those)
  pickup_line1 text not null,
  pickup_line2 text,
  pickup_city text not null,
  pickup_region text not null,
  pickup_postal text,
  pickup_country_code char(2) not null,
  pickup_lat numeric(9,6) not null,
  pickup_lng numeric(9,6) not null,

  dropoff_line1 text,                          -- null for labor_only (in-home work)
  dropoff_line2 text,
  dropoff_city text,
  dropoff_region text,
  dropoff_postal text,
  dropoff_country_code char(2),
  dropoff_lat numeric(9,6),
  dropoff_lng numeric(9,6),

  distance_km numeric(6,2),
  duration_min int,

  -- Schedule
  schedule_mode schedule_mode not null,
  scheduled_for_date date not null,
  scheduled_for_window text,                   -- '9:00 AM – 11:00 AM' or 'Earliest'
  scheduled_for_window_starts_at timestamptz,  -- precise UTC moment for sorting
  scheduled_for_window_ends_at timestamptz,

  -- Move details (type-specific) — validated client + edge fn via Zod, stored as JSON
  details jsonb not null default '{}'::jsonb,
  customer_notes text,

  -- Pricing (CENTS, integer)
  price_base_cents int not null default 0,
  price_rooms_cents int not null default 0,
  price_distance_cents int not null default 0,
  price_addons_cents int not null default 0,
  price_subtotal_cents int not null default 0,
  price_service_fee_cents int not null default 0,
  price_tax_cents int not null default 0,
  price_total_cents int not null default 0,
  price_commission_cents int not null default 0,
  pricing_model text not null default 'fixed', -- 'fixed' | 'hourly'
  pricing_breakdown jsonb,                     -- archived snapshot of calc inputs

  -- Assignment
  assigned_team_id uuid references partner_teams(id) on delete set null,
  assigned_company_id uuid references companies(id) on delete set null,
  assigned_driver_profile_id uuid references profiles(id) on delete set null,
  assigned_at timestamptz,

  -- Payment (Stripe)
  stripe_payment_intent_id text,
  payment_status payment_status not null default 'uncharged',
  promo_code_id uuid,                          -- FK in 0004

  -- Lifecycle timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  cancelled_by uuid references profiles(id) on delete set null,

  constraint bookings_pricing_nonneg check (
    price_base_cents >= 0 and price_subtotal_cents >= 0
    and price_total_cents >= 0 and price_commission_cents >= 0
  ),
  constraint bookings_coords_valid check (
    pickup_lat between -90 and 90 and pickup_lng between -180 and 180
    and (dropoff_lat is null or (dropoff_lat between -90 and 90 and dropoff_lng between -180 and 180))
  ),
  constraint bookings_labor_no_dropoff check (
    move_type <> 'labor_only' or dropoff_line1 is null
  ),
  constraint bookings_nonlabor_has_dropoff check (
    move_type = 'labor_only' or dropoff_line1 is not null
  )
);

create index bookings_customer_idx on bookings (customer_id, created_at desc);
create index bookings_status_idx on bookings (status) where status not in ('completed','cancelled','failed');
create index bookings_city_idx on bookings (city_id);
create index bookings_assigned_team_idx on bookings (assigned_team_id);
create index bookings_assigned_company_idx on bookings (assigned_company_id);
create index bookings_assigned_driver_idx on bookings (assigned_driver_profile_id);
create index bookings_scheduled_idx on bookings (scheduled_for_window_starts_at);
create index bookings_short_code_idx on bookings (short_code);

create trigger bookings_set_updated_at before update on bookings
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- BOOKING STATUS HISTORY (audit trail)
-- Every status transition recorded immutably.
-- -----------------------------------------------------------------------------

create table booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  old_status booking_status,
  new_status booking_status not null,
  changed_by uuid references profiles(id) on delete set null,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index bsh_booking_idx on booking_status_history (booking_id, created_at);

-- Auto-record status changes
create or replace function record_booking_status_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    insert into booking_status_history (booking_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif (new.status is distinct from old.status) then
    insert into booking_status_history (booking_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

create trigger bookings_status_history
  after insert or update of status on bookings
  for each row execute function record_booking_status_change();

-- -----------------------------------------------------------------------------
-- BOOKING TRACKING PINGS (driver location during a live job)
-- Append-only, pruned after 30 days via scheduled function.
-- -----------------------------------------------------------------------------

create table booking_tracking (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  driver_profile_id uuid not null references profiles(id) on delete cascade,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  heading numeric(5,2),
  speed_kph numeric(5,2),
  recorded_at timestamptz not null default now()
);
create index booking_tracking_booking_recent_idx on booking_tracking (booking_id, recorded_at desc);

-- -----------------------------------------------------------------------------
-- RATINGS
-- Bidirectional: customer rates partner, partner rates customer.
-- -----------------------------------------------------------------------------

create table ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  party rating_party not null,
  from_profile_id uuid not null references profiles(id) on delete cascade,
  to_profile_id uuid references profiles(id) on delete cascade,    -- customer recipient
  to_team_id uuid references partner_teams(id) on delete cascade,  -- team recipient
  to_company_id uuid references companies(id) on delete cascade,   -- company recipient

  overall smallint not null check (overall between 1 and 5),
  professionalism smallint check (professionalism between 1 and 5),
  timeliness smallint check (timeliness between 1 and 5),
  carefulness smallint check (carefulness between 1 and 5),
  communication smallint check (communication between 1 and 5),

  tags text[] not null default '{}'::text[],
  comment text,

  created_at timestamptz not null default now(),

  constraint ratings_one_recipient check (
    (to_profile_id is not null)::int +
    (to_team_id is not null)::int +
    (to_company_id is not null)::int = 1
  )
);

create unique index ratings_one_per_booking_party on ratings (booking_id, party);
create index ratings_to_profile_idx on ratings (to_profile_id);
create index ratings_to_team_idx on ratings (to_team_id);
create index ratings_to_company_idx on ratings (to_company_id);

-- -----------------------------------------------------------------------------
-- DISPUTES
-- -----------------------------------------------------------------------------

create table disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete restrict,
  opened_by uuid not null references profiles(id) on delete set null,
  against_profile_id uuid references profiles(id) on delete set null,
  against_company_id uuid references companies(id) on delete set null,
  kind dispute_kind not null,
  severity text not null default 'low',         -- low | medium | high
  summary text not null,
  status dispute_status not null default 'open',
  resolution_notes text,
  refund_cents int default 0,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disputes_booking_idx on disputes (booking_id);
create index disputes_status_idx on disputes (status) where status in ('open','in_review');

create trigger disputes_set_updated_at before update on disputes
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- CHAT
-- One thread per booking + a permanent customer↔support thread.
-- -----------------------------------------------------------------------------

create type chat_kind as enum ('booking', 'support');

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind chat_kind not null,
  booking_id uuid references bookings(id) on delete cascade,
  customer_profile_id uuid not null references profiles(id) on delete cascade,
  partner_profile_id uuid references profiles(id) on delete set null,
  is_admin_monitored boolean not null default true,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_booking_kind check (
    (kind = 'booking' and booking_id is not null) or
    (kind = 'support' and booking_id is null)
  )
);

create unique index chat_one_per_booking on chat_threads (booking_id) where booking_id is not null;
create index chat_threads_customer_idx on chat_threads (customer_profile_id);
create index chat_threads_partner_idx on chat_threads (partner_profile_id);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_profile_id uuid not null references profiles(id) on delete set null,
  is_admin boolean not null default false,
  body text not null,
  attachments jsonb,
  created_at timestamptz not null default now(),

  constraint chat_messages_body_length check (char_length(body) between 1 and 4000)
);

create index chat_messages_thread_idx on chat_messages (thread_id, created_at desc);
