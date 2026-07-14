-- =============================================================================
-- Stripe DIRECT payments (customer → Movvy's own Stripe account). NO Connect.
--
-- Money model (Adam's decision 2026-07-07): the customer pays Movvy directly;
-- Stripe pays Movvy's balance out to Movvy's bank on the normal schedule; Adam
-- pays the moving crews their 80% share manually, off-platform, using the
-- earnings the app already tracks. So there are no connected accounts, no
-- transfers, and no splits in Stripe — just a single-party charge.
--
-- Reuses existing columns from 0003/0045:
--   bookings.stripe_payment_intent_id, bookings.payment_status (enum),
--   bookings.actual_total_cents (final bill) / price_total_cents (estimate).
-- Adds only the settlement fields + an admin-facing payments ledger.
-- =============================================================================

-- Reusable Stripe customer id per person (lets returning customers reuse a
-- saved card later without re-entering it). Lives on the profile, not the
-- booking, so it's shared across all their moves.
alter table profiles
  add column if not exists stripe_customer_id text;

-- Settlement fields on the booking.
alter table bookings
  add column if not exists amount_paid_cents integer,
  add column if not exists paid_at timestamptz;

-- ─── Payments ledger — one row per Stripe PaymentIntent, kept in sync by the
-- webhook. This is what the web admin reads to see collected vs. owed. ───────
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete set null,
  customer_id uuid references profiles(id) on delete set null,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  amount_cents integer not null,
  currency text not null default 'cad',
  status text not null,               -- succeeded | processing | failed | refunded | partially_refunded | disputed
  refunded_cents integer not null default 0,
  raw_event_type text,                -- last Stripe event that touched this row
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_booking_idx  on payments (booking_id);
create index if not exists payments_customer_idx on payments (customer_id);
create index if not exists payments_created_idx  on payments (created_at desc);

-- RLS: customers read their own payment rows; admins/support read all.
-- There is deliberately NO insert/update policy — only the service-role
-- webhook writes here (service role bypasses RLS), so a customer can never
-- forge a "paid" record.
alter table payments enable row level security;

drop policy if exists payments_select_own on payments;
create policy payments_select_own on payments
  for select
  using (
    customer_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('movvy_admin', 'movvy_support')
    )
  );

-- Keep updated_at fresh on ledger writes.
create or replace function touch_payments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_touch_updated on payments;
create trigger payments_touch_updated
  before update on payments
  for each row execute function touch_payments_updated_at();
