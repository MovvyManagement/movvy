-- =============================================================================
-- Movvy — Migration 0018: Driver online/offline presence
--
-- Drivers (solo team + under a company) toggle online/offline. We persist
-- that bit on the profile so:
--   • the matcher only routes new requests to online drivers
--   • the company dispatch picker can sort online → offline and grey out
--     unavailable drivers
--
-- Solo team drivers already had a client-side toggle in jobs.tsx; now it
-- writes through to the DB. `last_online_at` lets us auto-time-out drivers
-- who closed the app without flipping offline (idle > 30 min → presumed
-- offline by the picker).
-- =============================================================================

alter table profiles
  add column is_online boolean not null default false,
  add column last_online_at timestamptz;

create index profiles_online_idx on profiles (is_online) where is_online = true;

-- Rebuild the company_drivers_roster RPC so it returns the new fields.
-- The picker UI sorts online → offline → busy.
create or replace function company_drivers_roster(p_company_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext,
  phone text,
  driver_license_number text,
  active_jobs int,
  is_online boolean,
  last_online_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  select my_company_role(p_company_id) into v_role;
  if v_role not in ('owner', 'dispatcher') then return; end if;

  return query
    select cm.profile_id,
           p.full_name,
           p.email,
           p.phone,
           cm.driver_license_number,
           coalesce((
             select count(*)::int from bookings b
             where b.assigned_driver_profile_id = cm.profile_id
               and b.status in ('assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading')
           ), 0) as active_jobs,
           -- Treat "online flag true AND seen within 30 min" as effectively online.
           -- Drivers who left the app idle without toggling fall to offline.
           (p.is_online and p.last_online_at > now() - interval '30 minutes') as is_online,
           p.last_online_at
    from company_members cm
    join profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id
      and cm.role = 'driver'
      and cm.removed_at is null
      and p.deleted_at is null
    order by
      (p.is_online and p.last_online_at > now() - interval '30 minutes') desc,
      cm.driver_license_number nulls last,
      p.full_name;
end;
$$;

-- RPC the driver app calls to flip presence + heartbeat.
create or replace function set_my_presence(p_online boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update profiles
  set is_online = p_online,
      last_online_at = case when p_online then now() else last_online_at end
  where id = auth.uid();
end;
$$;

revoke all on function set_my_presence(boolean) from public;
grant execute on function set_my_presence(boolean) to authenticated;
