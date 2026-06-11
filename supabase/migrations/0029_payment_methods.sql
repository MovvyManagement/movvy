-- =============================================================================
-- Movvy — Migration 0029: Saved payment methods + referral-code safety net
--
-- Phase 3 will swap the local card storage for Stripe Payment Methods (tokens
-- only — never raw PANs). For Phase 1/2 we let customers save the visible
-- non-sensitive card metadata (brand, last 4, expiry, cardholder, billing
-- postal) so the "Payment methods" UX is real instead of a placeholder.
--
-- IMPORTANT: the full PAN and CVV are NEVER stored. We capture them in the
-- client UI for visual confirmation, derive `brand` + `last4`, then discard.
-- Until Stripe lands, no money actually moves — this table is the customer-
-- visible registry of "cards I told Movvy about". `stripe_payment_method_id`
-- is the upgrade slot for Phase 3.
--
-- Referral codes: migration 0015 already auto-generates a code on profile
-- insert and backfilled every existing row. This migration adds an RPC the
-- client can call as a defensive backstop — if a customer somehow has a
-- null referral_code (e.g. very early signup before 0015 was applied), the
-- Invite Friends screen calls ensure_my_referral_code() and gets one
-- minted on the spot.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PAYMENT METHODS table
-- -----------------------------------------------------------------------------

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,

  -- Display metadata — safe to store in plaintext, surfaced in the UI.
  brand text not null
    check (brand in ('visa', 'mastercard', 'amex', 'discover', 'other')),
  last4 text not null
    check (length(last4) = 4 and last4 ~ '^[0-9]{4}$'),
  exp_month int not null check (exp_month between 1 and 12),
  exp_year  int not null check (exp_year  between 2024 and 2100),
  cardholder_name text not null check (length(cardholder_name) between 2 and 80),
  billing_postal text,

  -- Phase-3 swap slot: once Stripe Payment Methods land, write the tokenized
  -- id here and route charges through it instead of holding cards locally.
  stripe_payment_method_id text,

  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_methods_profile_idx
  on payment_methods (profile_id);

-- At most ONE default per profile, enforced via partial unique index.
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
-- RLS — owner-only
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

-- Admin override — Movvy support can audit + delete on request.
drop policy if exists payment_methods_admin_all on payment_methods;
create policy payment_methods_admin_all on payment_methods
  for all using (is_movvy_admin()) with check (is_movvy_admin());

-- -----------------------------------------------------------------------------
-- REFERRAL CODE — defensive RPC for the client
-- -----------------------------------------------------------------------------

create or replace function ensure_my_referral_code()
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select referral_code into v_code from profiles where id = v_user;

  -- The standard path (every signup since migration 0015 gets one via
  -- the insert trigger). Short-circuit fast.
  if v_code is not null then
    return v_code;
  end if;

  -- Fallback: mint one in-place. Uses the same generator the trigger
  -- uses so codes have a consistent shape ("MOV" + 4 base32 chars).
  v_code := gen_referral_code();
  update profiles set referral_code = v_code where id = v_user;
  return v_code;
end $$;

revoke all on function ensure_my_referral_code() from public;
grant execute on function ensure_my_referral_code() to authenticated;
