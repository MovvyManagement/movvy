-- =============================================================================
-- 0086 — The customer side and the partner side are separate registrations.
--
-- Until now one Movvy login opened both doors: a crew account signed in on the
-- customer screen and landed on the customer home with a partner session, and a
-- customer's credentials walked into the partner portal and got offered
-- onboarding. Two different products, two different sets of rules about what
-- you may see — they should not share a door.
--
-- Supabase Auth keys users by email/phone and refuses duplicates, so "register
-- twice on the same email" cannot mean two auth users. What it means here:
-- ONE identity, TWO independent registrations. Signing in proves who you are;
-- the registration stamp for that side decides whether the door opens. Someone
-- who wants both registers on both — same email, same password, two stamps.
--
-- Enforced in the app's two sign-in paths and readable in one call so neither
-- side has to reason about roles or memberships.
-- =============================================================================

alter table profiles
  add column if not exists customer_registered_at timestamptz,
  add column if not exists partner_registered_at  timestamptz;

comment on column profiles.customer_registered_at is
  'When this identity registered on the CUSTOMER side. Null = the customer app must refuse the sign-in.';
comment on column profiles.partner_registered_at is
  'When this identity registered on the PARTNER side. Null = the partner portal must refuse the sign-in.';

-- ── Backfill: nobody who already uses Movvy gets locked out ─────────────────
-- Partner side: any org membership, past or present, or a partner-shaped role.
update profiles p
   set partner_registered_at = coalesce(p.partner_registered_at, p.created_at, now())
 where p.partner_registered_at is null
   and (
     p.role in ('driver', 'mover', 'company_owner', 'company_dispatcher')
     or exists (select 1 from company_members cm where cm.profile_id = p.id)
     or exists (select 1 from partner_team_members ptm where ptm.profile_id = p.id)
   );

-- Customer side: an explicit customer role, a booking they placed, or Movvy
-- staff (the console is web-only, so staff use the customer app on mobile).
update profiles p
   set customer_registered_at = coalesce(p.customer_registered_at, p.created_at, now())
 where p.customer_registered_at is null
   and (
     p.role in ('customer', 'movvy_admin', 'movvy_support')
     or exists (select 1 from bookings b where b.customer_id = p.id)
   );

-- ── New signups stamp their own side ────────────────────────────────────────
-- The signup screens already declare which side they are via options.data.role
-- ('customer' from the customer form, 'company_owner' from the partner form),
-- so the side falls out of the metadata the client already sends. Doing it in
-- the trigger means the stamp exists before the first session does — no window
-- where a fresh signup is refused at its own front door.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_role user_role := coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'customer');
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
    -- Be defensive: parsing fails silently → NULL → the client will re-prompt
    -- on next launch, which is the correct outcome.
    nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
    case when v_is_partner then null else now() end,
    case when v_is_partner then now() else null end
  );
  return new;
end $$;

-- ── Which doors are open to me? ─────────────────────────────────────────────
create or replace function my_account_sides()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'customer', (select customer_registered_at is not null from profiles where id = auth.uid()),
    'partner',  (select partner_registered_at  is not null from profiles where id = auth.uid())
  );
$$;

grant execute on function my_account_sides() to authenticated;

-- ── Register the side you're standing at ────────────────────────────────────
-- Called when someone who already has a Movvy login signs up on the OTHER side.
-- They proved the password first (the app signs them in before calling this),
-- so this only ever adds a side to an identity that just authenticated. It
-- never removes one, and it never touches role — an existing customer who
-- registers as a partner keeps their bookings.
create or replace function register_account_side(p_side text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_side not in ('customer', 'partner') then
    raise exception 'unknown side %', p_side;
  end if;

  if p_side = 'customer' then
    update profiles set customer_registered_at = coalesce(customer_registered_at, now())
     where id = v_uid;
  else
    update profiles set partner_registered_at = coalesce(partner_registered_at, now())
     where id = v_uid;
  end if;

  return my_account_sides();
end $$;

grant execute on function register_account_side(text) to authenticated;
