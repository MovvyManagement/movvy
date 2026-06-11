-- =============================================================================
-- Movvy — Migration 0015: Referral program + account deletion
--
-- Referrals: every customer gets a 7-char code (e.g. "MOV4F2K"). When a new
-- customer signs up with that code, BOTH get a $50 credit applied as a one-time
-- promo redemption. Tracked via a referrals table that records the pairing.
--
-- Account deletion: soft-delete via profiles.deleted_at (column already exists).
-- A delete request also revokes the auth.users session so the customer can't
-- keep using the app — performed by the edge function account-delete.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- REFERRAL CODES on profiles
-- -----------------------------------------------------------------------------

alter table profiles
  add column if not exists referral_code text unique;

-- Generate a short, friendly code: "MOV" + 4 base32 chars
create or replace function gen_referral_code()
returns text language plpgsql as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- removed I, O, 0, 1 for clarity
  v_code text;
  v_tries int := 0;
begin
  loop
    v_code := 'MOV';
    for i in 1..4 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from profiles where referral_code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 8 then
      -- Extreme fallback — append a uuid suffix so we never loop forever
      v_code := v_code || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
      exit;
    end if;
  end loop;
  return v_code;
end $$;

-- Backfill existing profiles
update profiles set referral_code = gen_referral_code() where referral_code is null;

-- Auto-assign on insert
create or replace function profiles_assign_referral_code()
returns trigger language plpgsql as $$
begin
  if new.referral_code is null then
    new.referral_code := gen_referral_code();
  end if;
  return new;
end $$;

drop trigger if exists profiles_set_referral_code on profiles;
create trigger profiles_set_referral_code
  before insert on profiles
  for each row execute function profiles_assign_referral_code();

-- -----------------------------------------------------------------------------
-- REFERRALS TABLE — one row per accepted referral
-- -----------------------------------------------------------------------------

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_profile_id uuid not null references profiles(id) on delete cascade,
  referred_profile_id uuid not null references profiles(id) on delete cascade,
  referral_code_used text not null,
  credit_cents int not null default 5000,            -- $50 per side
  status text not null default 'pending',            -- pending → applied → revoked
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (referrer_profile_id <> referred_profile_id),
  constraint referrals_unique_pair unique (referrer_profile_id, referred_profile_id)
);

create index referrals_referrer_idx on referrals (referrer_profile_id, status);
create index referrals_referred_idx on referrals (referred_profile_id);

alter table referrals enable row level security;

create policy referrals_self_read on referrals for select
  using (referrer_profile_id = auth.uid() or referred_profile_id = auth.uid() or is_admin());

create policy referrals_self_insert on referrals for insert
  with check (referred_profile_id = auth.uid());

create policy referrals_admin_all on referrals for all
  using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- Account deletion helpers
-- -----------------------------------------------------------------------------

-- Wraps the soft-delete in a function so the edge function can call it cleanly.
create or replace function request_account_deletion(p_profile_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update profiles
    set deleted_at = now(),
        suspended_reason = coalesce(p_reason, 'Account deleted by user'),
        is_suspended = true,
        full_name = null,
        phone = null
    where id = p_profile_id;
  -- Strip saved addresses (PII)
  delete from saved_addresses where profile_id = p_profile_id;
  -- Strip device tokens (no future pushes)
  delete from device_tokens where profile_id = p_profile_id;
end $$;

grant execute on function request_account_deletion(uuid, text) to service_role;
