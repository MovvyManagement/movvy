-- =============================================================================
-- Movvy — Migration 0055: Sync admin_members -> profiles.role
--
-- The ops edge functions (reassign, cancel, resolve-dispute, suspend, verify)
-- gate on profiles.role in ('movvy_admin','movvy_support'). Employees added via
-- admin_members sign up with role='customer', so without this they could open
-- the console but every ACTION would 403. This keeps the real role in lockstep
-- with the allowlist:
--   management -> movvy_admin      staff -> movvy_support      blocked -> customer
--
-- Blocking therefore also revokes all admin API access, not just the UI.
-- The root management@movvy.ca is never touched. Manually-created movvy_admins
-- that aren't in the allowlist are left alone (we only ever downgrade a role we
-- ourselves granted).
-- =============================================================================

create or replace function public.sync_admin_role_for_email(p_email citext)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_level   text;
  v_blocked boolean;
begin
  if p_email is null then return; end if;
  -- Never modify the seeded root account.
  if lower(p_email) = 'management@movvy.ca' then return; end if;

  select access_level, blocked into v_level, v_blocked
  from admin_members where lower(email) = lower(p_email);

  if v_level is null then
    -- No longer on the allowlist: drop staff access we granted. Leave a
    -- manually-set movvy_admin intact (we never granted it here).
    update profiles set role = 'customer'
      where lower(email) = lower(p_email) and role = 'movvy_support';
    return;
  end if;

  if v_blocked then
    update profiles set role = 'customer'
      where lower(email) = lower(p_email) and role in ('movvy_support', 'movvy_admin');
    return;
  end if;

  update profiles
    set role = case when v_level = 'management' then 'movvy_admin'::user_role
                    else 'movvy_support'::user_role end
    where lower(email) = lower(p_email)
      and role is distinct from (case when v_level = 'management' then 'movvy_admin'::user_role
                                      else 'movvy_support'::user_role end);
end;
$$;

-- Fire whenever an allowlist row changes.
create or replace function public.trg_admin_members_role_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_admin_role_for_email(coalesce(new.email, old.email));
  return coalesce(new, old);
end;
$$;

drop trigger if exists admin_members_role_sync on admin_members;
create trigger admin_members_role_sync
  after insert or update or delete on admin_members
  for each row execute function public.trg_admin_members_role_sync();

-- Fire when a profile is created (invited employee finally signs up) so they
-- pick up their role without a manual step.
create or replace function public.trg_profiles_admin_role_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is not null then
    perform public.sync_admin_role_for_email(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_admin_role_on_insert on profiles;
create trigger profiles_admin_role_on_insert
  after insert on profiles
  for each row execute function public.trg_profiles_admin_role_on_insert();

-- Backfill any existing accounts that already match an allowlist entry.
do $$
declare r record;
begin
  for r in select email from admin_members loop
    perform public.sync_admin_role_for_email(r.email);
  end loop;
end $$;
