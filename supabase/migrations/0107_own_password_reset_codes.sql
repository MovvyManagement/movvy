-- =============================================================================
-- Migration 0107 — Movvy's own password-reset codes
--
-- WHY, precisely: the reset flow used Supabase's OTP endpoint, and that endpoint
-- is a public account-enumeration oracle. Verified against production with only
-- the anon key that ships inside the app:
--
--   POST /auth/v1/otp {"email":"management@movvy.ca","create_user":false}
--     → 200 {}
--   POST /auth/v1/otp {"email":"nobody@…","create_user":false}
--     → 422 {"error_code":"otp_disabled","msg":"Signups not allowed for otp"}
--
-- A clean yes/no per address, at scale, for free. The app's own error handling
-- already masked this in the UI — but that is irrelevant, because an attacker
-- calls Supabase directly and never touches our client. Moving the send into an
-- edge function would not have fixed it either, for the same reason.
--
-- So resets stop using Supabase OTP. We mint our own codes here, send them
-- ourselves, and always answer the request endpoint with 200 — the response is
-- identical whether or not the contact exists, because the branch that differs
-- happens after we've already decided what to return.
--
-- Bonus: this also removes a design wart. Supabase's verifyOtp SIGNED THE USER
-- IN as a side effect, which is why forgot-password.tsx needed an explicit
-- customer/partner side check afterwards to stop a partner-only account walking
-- into the customer app. Setting the password with the service role instead
-- means no session is ever created by the reset itself.
--
-- The code is stored as a SHA-256 hash. A six-digit code is trivially
-- brute-forcible offline, so the hash isn't real protection against a stolen
-- table — the attempt counter and the ten-minute expiry are. The hash is there
-- so a leaked backup doesn't hand out live codes.
-- =============================================================================

create table if not exists password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- Normalised email (lowercased) or E.164 phone the code was sent to.
  contact text not null,
  channel text not null check (channel in ('email', 'sms')),
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  -- Wrong guesses. Five and the code is dead, so the six-digit space can't be
  -- walked online.
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_contact_idx
  on password_reset_codes (contact, created_at desc)
  where consumed_at is null;

create index if not exists password_reset_codes_expiry_idx
  on password_reset_codes (expires_at)
  where consumed_at is null;

-- No client touches this table, ever. RLS on with NO policies = service role
-- only, which is what the edge functions use. Being able to read a code hash,
-- or even to see that a row exists for an address, would rebuild the oracle
-- we're closing.
alter table password_reset_codes enable row level security;

revoke all on password_reset_codes from anon, authenticated;
grant all on password_reset_codes to service_role;

-- Housekeeping: consumed and expired codes have no value and are a liability.
create or replace function purge_password_reset_codes()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from password_reset_codes
   where (consumed_at is not null and consumed_at < now() - interval '1 day')
      or expires_at < now() - interval '1 day';
$$;

grant execute on function purge_password_reset_codes() to service_role;

notify pgrst, 'reload schema';
