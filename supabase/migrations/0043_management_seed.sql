-- =============================================================================
-- Migration 0043 — Management account hot-wire
--
-- Seeds a fully-baked founder/QA account so management@movvy.ca can sign in
-- via /(auth)/partner-signin with code TM-XXXXXX and immediately operate as
-- a verified mover (see bookings, accept bookings, etc.) without going
-- through the normal onboarding flow.
--
-- What this migration creates:
--   1. auth.users row for management@movvy.ca with the password hashed in.
--   2. auth.identities row so Supabase recognizes the email/password login.
--   3. profile row (auto-created by handle_new_user trigger) patched with
--      full_name + phone + role so the UI renders correctly.
--   4. partner_teams row with invite_code FORCED to 'TM-XXXXXX' (the
--      set_partner_invite_code trigger only fills when null, so passing the
--      literal value wins) and onboarding_status = 'verified' so the
--      dispatch system + RLS treat the team as eligible immediately.
--   5. partner_team_members row linking the management profile as the
--      team's driver (license number is a placeholder to satisfy the
--      ptm_driver_has_license check constraint).
--
-- ⚠️  PASSWORD WARNING
-- The password 'Adam.20182018' is baked into this migration. Anyone with
-- read access to the repo or the production DB can see it. Rotate it via
-- the Supabase auth admin panel ASAP after first login, then squash this
-- migration if you want the literal removed from history.
--
-- All inserts are idempotent — re-running the migration is a no-op.
-- =============================================================================

-- pgcrypto is needed for crypt() + gen_salt(). On Supabase it's installed
-- in the `extensions` schema (not `public`), so we either need to add
-- `extensions` to the search_path or call functions schema-qualified. We
-- do the latter below — `extensions.crypt(...)` and `extensions.gen_salt(...)`.
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_user_id constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  v_team_id constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  v_email   constant text := 'management@movvy.ca';
  v_phone   constant text := '+18005550123';
  v_city_id uuid;
begin
  -- Calgary is the founder's home market — seeded in migration 0006.
  select id into v_city_id from cities where slug = 'calgary' limit 1;
  if v_city_id is null then
    raise exception 'Calgary city not found — 0006 must run before 0043';
  end if;

  -- ───────────────────────────────────────────────────────────────────────
  -- 1) auth.users
  -- ───────────────────────────────────────────────────────────────────────
  -- Direct insert because the migration runs before the app exists.
  -- handle_new_user trigger (0006) fires AFTER INSERT and creates the
  -- public.profiles row, pulling full_name + phone out of raw_user_meta_data.
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    phone,
    phone_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt('Adam.20182018', extensions.gen_salt('bf')),
    now(),
    v_phone,
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    jsonb_build_object(
      'full_name', 'Movvy Management',
      'phone', v_phone,
      'role', 'movvy_admin'
    ),
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  on conflict (id) do nothing;

  -- ───────────────────────────────────────────────────────────────────────
  -- 2) auth.identities  (Supabase >=2024 requires this for password login)
  -- ───────────────────────────────────────────────────────────────────────
  -- The identity_data jsonb has to include `sub` (the user id) for the
  -- GoTrue session check. provider_id matches sub for email/password.
  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    v_user_id::text,
    v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do nothing;

  -- ───────────────────────────────────────────────────────────────────────
  -- 3) Patch the auto-created profile
  -- ───────────────────────────────────────────────────────────────────────
  -- handle_new_user already pulled full_name/phone from raw_user_meta_data,
  -- but we set them explicitly here so the migration is robust to any
  -- future change to that trigger. Also pin role to 'mover' (in case the
  -- enum default ever shifts) so all the (mover)/* RLS predicates pass.
  update profiles
  set
    full_name = 'Movvy Management',
    phone = v_phone,
    role = 'movvy_admin'
  where id = v_user_id;

  -- ───────────────────────────────────────────────────────────────────────
  -- 4) partner_teams — verified + literal invite_code = TM-XXXXXX
  -- ───────────────────────────────────────────────────────────────────────
  -- set_partner_invite_code (migration 0016) only fires when invite_code is
  -- NULL, so passing the literal 'TM-XXXXXX' wins. The unique constraint
  -- on invite_code means a second run won't try to create a duplicate
  -- because of `on conflict (id) do nothing`.
  insert into partner_teams (
    id,
    display_name,
    primary_city_id,
    onboarding_status,
    verified_at,
    invite_code,
    service_radius_km,
    rating_avg,
    rating_count,
    created_at,
    updated_at
  )
  values (
    v_team_id,
    'Movvy Management',
    v_city_id,
    'verified',
    now(),
    'TM-XXXXXX',
    100,
    null,
    0,
    now(),
    now()
  )
  on conflict (id) do nothing;

  -- ───────────────────────────────────────────────────────────────────────
  -- 5) partner_team_members — management profile as driver
  -- ───────────────────────────────────────────────────────────────────────
  -- ptm_driver_has_license check constraint requires a non-null license
  -- when role = 'driver'. The placeholder satisfies it; real verification
  -- isn't needed because onboarding_status is already 'verified' on the
  -- team and admin RLS doesn't look at this field.
  insert into partner_team_members (
    team_id,
    profile_id,
    role,
    driver_license_number,
    invited_at,
    accepted_at
  )
  values (
    v_team_id,
    v_user_id,
    'driver',
    'MGMT-OVERRIDE',
    now(),
    now()
  )
  on conflict do nothing;
end $$;

-- Tell PostgREST to reload its schema cache so the new rows are visible
-- to API clients without restarting the database.
notify pgrst, 'reload schema';
