-- =============================================================================
-- Migration 0101 — two live, separately-proven privilege holes
--
-- Both were demonstrated end-to-end against THIS production project with
-- nothing but the public anon key, which ships inside the app bundle and is
-- also exposed as NEXT_PUBLIC_SUPABASE_ANON_KEY on movvy.ca.
--
-- ── HOLE 1 · anyone could sign themselves up as movvy_admin ─────────────────
-- handle_new_user() took the role straight from client-controlled signup
-- metadata with no whitelist (0086:62, and the same in 0006:19 / 0033:49):
--
--     v_role user_role := coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'customer');
--
-- So POST /auth/v1/signup with {"data":{"role":"movvy_admin"}} produced a real
-- movvy_admin. Verified: movvy_admin_access() returned 'management', and that
-- account could read admin_members, every row of profiles (emails + phones),
-- and feature_flags including stripe_live_enabled — then use any admin-* edge
-- function, because they all authorise on profiles.role: suspend users, approve
-- partners, reassign and refund bookings, resolve disputes, create promos, flip
-- the paid-API kill switches.
--
-- Fix: whitelist. Only the self-service roles may be requested at signup; the
-- two staff roles can never come from metadata. Anything else silently becomes
-- 'customer' — fail closed, and don't tell a prober which values are special.
-- Movvy staff get their role assigned deliberately, server-side.
--
-- ── HOLE 2 · an assigned crew member could rewrite the invoice ──────────────
-- bookings_partner_update (0005:259) grants the assigned crew UPDATE with no
-- column list, and lock_booking_after_assignment (0006:116) guarded only six
-- fields — none of them the ones the final bill is computed from. Verified with
-- an ordinary crew JWT on an on_the_way booking, all HTTP 200:
--
--     hourly_rate_customer_cents -> 100000, started_at moved back 8h,
--     materials_cents -> 50000, fuel_cents -> 30000
--     tip_cents / tip_driver_cents -> 50000
--     is_long_haul -> true, transit_km -> 400, transit_cents -> 160000
--     assigned_company_id -> an org the user isn't even a member of
--
-- bookings-update-status reads exactly those columns and feeds them to
-- computeActualBill, and stripe-create-payment-intent charges the result to the
-- customer's card. A 3-bed move that should bill $2,350 becomes $18,480, with
-- $14,784 of it flowing to the crew. Rewriting assigned_company_id also walks
-- straight around the "left HQ" reassignment guard and redirects the payout,
-- since my_payout_summary keys on that column.
--
-- Fix: invert the rule. Rather than blacklisting money columns — a list that
-- goes stale the moment someone adds a column — allow a partner to change only
-- `status` (still independently validated by enforce_booking_status_transition)
-- and `updated_at`, and reject any other difference between OLD and NEW. This
-- is safe because NOTHING in the app writes to bookings directly: every write
-- goes through an edge function on the service role. Verified by grep over
-- app/ and src/ — zero `from('bookings').update(...)` call sites.
-- =============================================================================

-- ── A service-role check that works from PostgREST ──────────────────────────
-- is_admin() cannot serve here: it resolves auth.uid() against profiles, and a
-- service-role request has no auth.uid(), so is_admin() is FALSE for our own
-- edge functions. Without this, locking the billing columns would break
-- bookings-update-status writing the actual bill.
create or replace function is_service_role()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role'
  or current_user = 'service_role';
$$;

grant execute on function is_service_role() to authenticated, anon, service_role;

-- ── HOLE 1 ─────────────────────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  -- Read as TEXT first. Casting straight to user_role would accept
  -- 'movvy_admin' as a perfectly valid enum value, which is the whole bug.
  v_requested text := new.raw_user_meta_data ->> 'role';
  v_role user_role := case
    when v_requested in ('customer', 'driver', 'mover', 'company_owner', 'company_dispatcher')
      then v_requested::user_role
    else 'customer'
  end;
  v_is_partner boolean := v_role in ('driver', 'mover', 'company_owner', 'company_dispatcher');
begin
  insert into public.profiles (
    id, role, email, full_name, phone,
    terms_accepted_version, terms_accepted_at,
    customer_registered_at, partner_registered_at
  )
  values (
    new.id,
    v_role,
    new.email::citext,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'terms_accepted_version',
    nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
    case when v_is_partner then null else now() end,
    case when v_is_partner then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ── HOLE 2 ─────────────────────────────────────────────────────────────────
create or replace function lock_booking_after_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- The ONLY columns a non-admin, non-service caller may alter. Everything
  -- else — rates, hours, timestamps, tips, transit, assignment, payment — is
  -- server-owned. Adding a column to bookings automatically protects it.
  v_allowed text[] := array['status', 'updated_at'];
  v_old jsonb;
  v_new jsonb;
begin
  if is_admin() or is_service_role() then return new; end if;

  v_old := to_jsonb(old) - v_allowed;
  v_new := to_jsonb(new) - v_allowed;

  if v_old <> v_new then
    raise exception
      'Bookings are server-owned: use the Movvy API to change anything but status'
      using errcode = '22023';
  end if;

  return new;
end $$;

-- The trigger itself is unchanged (bookings_lock_after_assignment from 0006);
-- create-or-replace swaps the body in place. Re-assert it anyway in case an
-- earlier migration dropped it, so this file is self-contained.
drop trigger if exists bookings_lock_after_assignment on bookings;
create trigger bookings_lock_after_assignment
  before update on bookings
  for each row execute function lock_booking_after_assignment();

notify pgrst, 'reload schema';
