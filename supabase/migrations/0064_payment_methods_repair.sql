-- =============================================================================
-- Movvy — Migration 0064: repair missing payment_methods table
--
-- Migration 0029 is recorded as applied in the remote migration history, but
-- the table does not exist on the remote database (verified 2026-07-18: REST
-- probe returned 404 "Could not find the table 'public.payment_methods' in
-- the schema cache", and the customer app's Add-card screen failed with that
-- exact error). `db push` reports "up to date" and therefore will never
-- re-run 0029, so the table has to be recreated by a forward migration.
--
-- Every statement below is idempotent (if not exists / drop-then-create), so
-- this is safe to run whether or not parts of 0029 survived.
--
-- Card data policy is unchanged from 0029: the full PAN and CVV are NEVER
-- stored — the client derives brand + last4 for display and discards the rest.
-- `stripe_payment_method_id` remains the slot for tokenized Stripe cards.
-- =============================================================================

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,

  brand text not null
    check (brand in ('visa', 'mastercard', 'amex', 'discover', 'other')),
  last4 text not null
    check (length(last4) = 4 and last4 ~ '^[0-9]{4}$'),
  exp_month int not null check (exp_month between 1 and 12),
  exp_year  int not null check (exp_year  between 2024 and 2100),
  cardholder_name text not null check (length(cardholder_name) between 2 and 80),
  billing_postal text,

  stripe_payment_method_id text,

  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_methods_profile_idx
  on payment_methods (profile_id);

-- At most ONE default per profile.
create unique index if not exists payment_methods_one_default
  on payment_methods (profile_id) where is_default;

create or replace function payment_methods_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists payment_methods_updated_at on payment_methods;
create trigger payment_methods_updated_at
  before update on payment_methods
  for each row execute function payment_methods_set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — owner-only, plus admin override for support
-- -----------------------------------------------------------------------------

alter table payment_methods enable row level security;

drop policy if exists payment_methods_select_own on payment_methods;
create policy payment_methods_select_own on payment_methods
  for select using (profile_id = auth.uid());

drop policy if exists payment_methods_insert_own on payment_methods;
create policy payment_methods_insert_own on payment_methods
  for insert with check (profile_id = auth.uid());

drop policy if exists payment_methods_update_own on payment_methods;
create policy payment_methods_update_own on payment_methods
  for update using (profile_id = auth.uid())
              with check (profile_id = auth.uid());

drop policy if exists payment_methods_delete_own on payment_methods;
create policy payment_methods_delete_own on payment_methods
  for delete using (profile_id = auth.uid());

-- NOTE: 0029 called is_movvy_admin(), which has never existed on this
-- database — that error is what aborted 0029 and left the table missing
-- while its migration row was still recorded. The real helper, used by 59
-- other policies, is is_admin().
drop policy if exists payment_methods_admin_all on payment_methods;
create policy payment_methods_admin_all on payment_methods
  for all using (is_admin()) with check (is_admin());
