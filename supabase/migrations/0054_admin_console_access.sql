-- =============================================================================
-- Movvy — Migration 0054: Admin console access control (management vs staff)
--
-- Adds a two-tier access model for the ops console:
--   • management — sees everything including the Revenue screen + can manage
--     employees. management@movvy.ca is the seeded, non-removable root.
--   • staff      — sees Moves / Support / Approvals but NO revenue anywhere.
--
-- Employees are added by email into admin_members and invited via Supabase
-- auth (edge fn admin-console). `blocked` lets management lock someone out of
-- ever signing in, even if their auth account still exists.
--
-- Legacy roles keep working so the founder can never lock themselves out:
--   role='movvy_admin'   -> management     role='movvy_support' -> staff
-- =============================================================================

-- ─── admin_members: the employee allowlist ───────────────────────────────────
create table if not exists admin_members (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  full_name    text,
  access_level text not null default 'staff' check (access_level in ('management', 'staff')),
  blocked      boolean not null default false,   -- locks them out of the console
  invited_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── admin_settings: server-only key/value (holds the salted revenue PIN) ─────
-- No user-facing RLS policy at all — the PIN hash is read/written ONLY by the
-- service-role edge function, never by a browser session.
create table if not exists admin_settings (
  key        text primary key,
  value      text not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── Access resolver — the single source of truth for console tier ───────────
-- Returns 'management' | 'staff' | null for the calling user. SECURITY DEFINER
-- so RLS policies + the app + the edge fn all agree on one answer.
create or replace function public.movvy_admin_access()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  user_role;
  v_email citext;
  v_member admin_members%rowtype;
begin
  select role, email into v_role, v_email from profiles where id = auth.uid();
  if v_role is null then
    return null;
  end if;

  -- Founder / root bootstrap — always management, never blockable.
  if v_role = 'movvy_admin' or lower(v_email) = 'management@movvy.ca' then
    return 'management';
  end if;

  -- Otherwise resolve from the employee allowlist, honouring `blocked`.
  select * into v_member from admin_members where lower(email) = lower(v_email);
  if found then
    if v_member.blocked then
      return null;                 -- explicitly locked out
    end if;
    return v_member.access_level;
  end if;

  -- Legacy support agents (not in the allowlist) get staff access.
  if v_role = 'movvy_support' then
    return 'staff';
  end if;

  return null;
end;
$$;

revoke all on function public.movvy_admin_access() from public;
grant execute on function public.movvy_admin_access() to authenticated;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table admin_members enable row level security;
alter table admin_settings enable row level security;

-- Only management may read the employee list. Writes are service-role only
-- (the admin-console edge fn), so there are deliberately no write policies.
drop policy if exists admin_members_select_management on admin_members;
create policy admin_members_select_management
  on admin_members for select
  using (public.movvy_admin_access() = 'management');

-- admin_settings: no policies -> RLS denies every browser session. The PIN
-- hash is touched only by the service-role edge function.

-- ─── Seed the root management account ────────────────────────────────────────
insert into admin_members (email, full_name, access_level)
values ('management@movvy.ca', 'Movvy Management', 'management')
on conflict (email) do update set access_level = 'management', blocked = false;

-- updated_at touch
create or replace function public.touch_admin_members_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_admin_members on admin_members;
create trigger touch_admin_members
  before update on admin_members
  for each row execute function public.touch_admin_members_updated_at();
