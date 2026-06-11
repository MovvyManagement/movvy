-- =============================================================================
-- Movvy — Migration 0030: ensure_my_profile() recovery RPC
--
-- The standard signup path runs handle_new_user (migration 0006) as an AFTER
-- INSERT trigger on auth.users, which mirrors the auth row into public.profiles.
-- Two scenarios leave us with an auth.users row but no profiles row:
--
--   • Accounts created before the trigger was installed (early test users)
--   • Trigger silently failed (e.g. a stale role string in raw_user_meta_data
--     that couldn't cast to user_role)
--
-- In either case every client write to profiles is a 0-row UPDATE, which the
-- Supabase JS client reports as "cannot coerce the result to a single json
-- object" because .single() expects exactly one returned row.
--
-- This RPC is the recovery hatch. It runs as SECURITY DEFINER so it bypasses
-- the policy that forbids direct profile inserts, and force-defaults the role
-- to 'customer' so a user can't accidentally self-promote.
-- =============================================================================

create or replace function ensure_my_profile()
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_phone text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from profiles where id = v_user) then
    return;
  end if;

  -- Pull the auth-row metadata so the synthesised profile matches what
  -- handle_new_user would have inserted.
  select
    email::text,
    raw_user_meta_data ->> 'full_name',
    raw_user_meta_data ->> 'phone'
  into v_email, v_full_name, v_phone
  from auth.users
  where id = v_user;

  insert into profiles (id, role, email, full_name, phone)
  values (v_user, 'customer', v_email, v_full_name, v_phone)
  on conflict (id) do nothing;
end $$;

revoke all on function ensure_my_profile() from public;
grant execute on function ensure_my_profile() to authenticated;
