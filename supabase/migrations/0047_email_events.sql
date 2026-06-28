-- =============================================================================
-- email_events — captures every Resend webhook event so we can see delivery
-- history, attribute bounces back to the original send, and surface email
-- health in the admin dashboard.
--
-- Resend fires these event types:
--   email.sent         — handed to the provider
--   email.delivered    — accepted by the recipient's MX
--   email.bounced      — rejected (hard or soft)
--   email.complained   — recipient marked as spam
--   email.opened       — pixel beacon fired
--   email.clicked      — recipient clicked a tracked link
--
-- The provider_id (Resend's "email id") is the join key back to whatever
-- code sent the email. The `template` tag is set by sendBrandedEmail() so
-- we can group analytics by template (welcomeCustomer vs bookingConfirmed).
-- =============================================================================

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,          -- Resend's email id ("re_...")
  event_type text not null,           -- 'sent' | 'delivered' | 'bounced' | ...
  template text,                      -- e.g. 'welcomeCustomer'
  kind text,                          -- 'customer' | 'partner' | 'support'
  recipient text,                     -- email address (lowercased)
  subject text,
  -- Bounce-specific fields. NULL for non-bounce events.
  bounce_type text,                   -- 'hard' | 'soft' | 'undetermined'
  bounce_reason text,
  -- Click / open URL when applicable.
  url text,
  -- Full Resend payload, for debugging or backfilling new fields later.
  raw jsonb not null,
  -- Resend's event timestamp (not our insert time — those can drift).
  occurred_at timestamptz not null default now(),
  inserted_at timestamptz not null default now()
);

create index if not exists email_events_provider_id_idx on email_events (provider_id);
create index if not exists email_events_recipient_idx on email_events (recipient);
create index if not exists email_events_template_idx on email_events (template);
create index if not exists email_events_occurred_at_idx on email_events (occurred_at desc);
create index if not exists email_events_event_type_idx on email_events (event_type);

-- RLS — admins only. Nothing here should ever be exposed to a customer.
alter table email_events enable row level security;

drop policy if exists "email_events admin read" on email_events;
create policy "email_events admin read"
  on email_events for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('movvy_admin', 'movvy_support')
    )
  );

-- Note: inserts come from the resend-webhook edge function (which uses the
-- service-role client), so no insert policy is needed for end users.

-- ─── Quick health view ──────────────────────────────────────────────────────
-- Last 30 days, grouped by template + event_type. Powers the admin email
-- health card. Defined as a regular view (not materialized) — refreshes on
-- every read but only ever scans the last 30 days via the index.

create or replace view v_email_health_30d as
  select
    template,
    event_type,
    count(*) as event_count,
    count(distinct recipient) as unique_recipients
  from email_events
  where occurred_at >= now() - interval '30 days'
  group by template, event_type
  order by template, event_type;
