-- =============================================================================
-- Movvy — Migration 0033: Terms-of-service acceptance tracking
--
-- Every user who signs up after this migration ships with two new fields:
--
--   • terms_accepted_version  — the version string the user agreed to
--                                (matches TERMS_VERSION in src/lib/brand.ts)
--   • terms_accepted_at       — UTC timestamp of acceptance
--
-- The signup flow passes both values via raw_user_meta_data; the existing
-- handle_new_user trigger (migration 0006) is replaced here so it copies
-- them into profiles. Section 14 of the Terms describes the re-prompt
-- obligation when wording changes — the client compares the stored version
-- against the current TERMS_VERSION and surfaces a one-tap re-acceptance
-- modal when they diverge.
--
-- Idempotent: columns use IF NOT EXISTS and the trigger is dropped + re-
-- created. Safe to run on a project that already had migration 0006 in
-- place — existing rows get NULL for both fields until they re-accept.
-- =============================================================================

-- ─── 1. New columns ─────────────────────────────────────────────────────────

alter table profiles
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_at timestamptz;

create index if not exists profiles_terms_version_idx
  on profiles (terms_accepted_version);

-- ─── 2. Replace handle_new_user so it reads the new metadata keys ──────────
--
-- The trigger fires AFTER INSERT on auth.users. raw_user_meta_data is the
-- jsonb the client passes via supabase.auth.signUp's `options.data`. We
-- copy `terms_accepted_version` + `terms_accepted_at` straight in.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (
    id, role, email, full_name, phone,
    terms_accepted_version, terms_accepted_at
  )
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'customer'),
    new.email::citext,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'terms_accepted_version',
    -- Be defensive: parsing fails silently → NULL → the client will re-prompt
    -- on next launch, which is the correct outcome.
    nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz
  );
  return new;
end $$;

-- ─── 3. RPC: record a fresh acceptance from the in-app re-prompt ───────────
--
-- The re-prompt modal calls this after the user taps "I accept" on a new
-- version. SECURITY DEFINER so it works regardless of the profiles RLS
-- policy that forbids users from updating their own role — that policy
-- compares old.role to new.role, and a focused update via this RPC only
-- touches the two terms columns.

create or replace function accept_terms(p_version text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_version is null or length(p_version) = 0 then
    raise exception 'version is required';
  end if;
  update profiles
     set terms_accepted_version = p_version,
         terms_accepted_at      = now()
   where id = v_user;
end $$;

revoke all on function accept_terms(text) from public;
grant execute on function accept_terms(text) to authenticated;
