-- =============================================================================
-- Apply this ONE snippet in Supabase Studio → SQL Editor → New query → Run
--
-- It bundles every schema piece your DB is missing so the demo seed script
-- (scripts/seed-demo.mjs) can finish successfully and the app's partner
-- sign-in + dispatch flows work.
--
-- Bundled migrations:
--   0006  handle_new_user trigger          (auto-create profile row)
--   0016  invite_code + partner_invites    (team/company invite gate)
--   0017  dispatch state                   (company dispatch flow)
--   0018  driver presence                  (online/offline + last seen)
--   0019  driver availability blocks       (block days off)
--   0021  public review feed               (per-crew reviews)
--   0023  declined invite status           (Accept/Decline popup)
--
-- Every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS,
-- so running this on a database that already has SOME of these is safe.
-- =============================================================================

-- ─── 0006 — handle_new_user trigger ─────────────────────────────────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 0016 — invite_code + partner_invites ────────────────────────────────────

alter table partner_teams add column if not exists invite_code text;
alter table companies     add column if not exists invite_code text;

create or replace function gen_movvy_invite_code(p_prefix text)
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  result text;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    end loop;
    result := p_prefix || '-' || code;
    if not exists (select 1 from partner_teams where invite_code = result)
       and not exists (select 1 from companies where invite_code = result) then
      return result;
    end if;
    attempts := attempts + 1;
    if attempts > 12 then raise exception 'Could not generate unique invite code'; end if;
  end loop;
end $$;

create or replace function set_partner_invite_code() returns trigger language plpgsql as $$
begin
  if new.invite_code is null then
    new.invite_code := gen_movvy_invite_code(
      case TG_TABLE_NAME when 'partner_teams' then 'TM' else 'CO' end
    );
  end if;
  return new;
end $$;

drop trigger if exists partner_teams_invite_code on partner_teams;
create trigger partner_teams_invite_code
  before insert on partner_teams
  for each row execute function set_partner_invite_code();
drop trigger if exists companies_invite_code on companies;
create trigger companies_invite_code
  before insert on companies
  for each row execute function set_partner_invite_code();

-- Backfill any pre-existing rows
update partner_teams set invite_code = gen_movvy_invite_code('TM') where invite_code is null;
update companies     set invite_code = gen_movvy_invite_code('CO') where invite_code is null;

-- Lock down: required + unique
do $$ begin
  alter table partner_teams alter column invite_code set not null;
  alter table companies     alter column invite_code set not null;
exception when others then null; end $$;

do $$ begin
  alter table partner_teams add constraint partner_teams_invite_code_unique unique (invite_code);
exception when duplicate_table then null; end $$;
do $$ begin
  alter table companies add constraint companies_invite_code_unique unique (invite_code);
exception when duplicate_table then null; end $$;

-- partner_invite_status enum (includes 'declined' from 0023)
do $$ begin
  create type partner_invite_status as enum ('pending', 'sent', 'accepted', 'expired', 'cancelled', 'declined');
exception when duplicate_object then
  alter type partner_invite_status add value if not exists 'declined';
end $$;

create table if not exists partner_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references partner_teams(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  role text not null check (role in ('driver', 'mover', 'dispatcher')),
  full_name text,
  email citext,
  phone text,
  status partner_invite_status not null default 'pending',
  invited_by_profile_id uuid not null references profiles(id) on delete cascade,
  accepted_by_profile_id uuid references profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  sent_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  last_channel text check (last_channel in ('sms', 'email', 'both', null)),
  last_provider_msg_id text,
  last_send_error text,
  constraint partner_invites_one_recipient check (
    (team_id is not null)::int + (company_id is not null)::int = 1
  ),
  constraint partner_invites_has_contact check (email is not null or phone is not null)
);

alter table partner_invites enable row level security;

drop policy if exists partner_invites_read on partner_invites;
create policy partner_invites_read on partner_invites for select
  using (
    invited_by_profile_id = auth.uid()
    or (team_id is not null and exists (
      select 1 from partner_team_members ptm
      where ptm.team_id = partner_invites.team_id
        and ptm.profile_id = auth.uid()
        and ptm.removed_at is null
    ))
    or (company_id is not null and exists (
      select 1 from company_members cm
      where cm.company_id = partner_invites.company_id
        and cm.profile_id = auth.uid()
        and cm.removed_at is null
    ))
  );

-- ─── 0017 — dispatch state ──────────────────────────────────────────────────

alter table bookings add column if not exists dispatch_accepted_at timestamptz;

create or replace function my_company_role(p_company_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role::text from company_members
  where company_id = p_company_id and profile_id = auth.uid() and removed_at is null
  limit 1;
$$;

create or replace function my_company_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select company_id from company_members
  where profile_id = auth.uid() and removed_at is null
  limit 1;
$$;

-- ─── 0018 — driver presence ─────────────────────────────────────────────────

alter table profiles add column if not exists is_online boolean not null default false;
alter table profiles add column if not exists last_online_at timestamptz;

create or replace function set_my_presence(p_online boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update profiles
  set is_online = p_online,
      last_online_at = case when p_online then now() else last_online_at end
  where id = auth.uid();
end $$;

-- ─── 0019 — driver availability blocks ──────────────────────────────────────

create table if not exists driver_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references profiles(id) on delete cascade,
  blocked_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint driver_availability_unique_day unique (driver_profile_id, blocked_date)
);

alter table driver_availability_blocks enable row level security;

drop policy if exists driver_availability_self on driver_availability_blocks;
create policy driver_availability_self on driver_availability_blocks for all
  using (driver_profile_id = auth.uid())
  with check (driver_profile_id = auth.uid());

-- ─── Re-grant everything to service_role + authenticated so the seed runs ──

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  profiles, saved_addresses, vehicles, companies, company_members,
  partner_teams, partner_team_members, verification_documents,
  bookings, ratings, disputes, chat_threads, chat_messages,
  booking_tracking, notifications, device_tokens,
  driver_availability_blocks
to authenticated;

grant execute on function my_company_role(uuid)       to authenticated;
grant execute on function my_company_id()             to authenticated;
grant execute on function set_my_presence(boolean)    to authenticated;

-- ─── Done. Re-run scripts/seed-demo.mjs from your terminal. ────────────────
