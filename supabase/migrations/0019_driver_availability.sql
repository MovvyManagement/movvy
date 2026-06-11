-- =============================================================================
-- Movvy — Migration 0019: Driver availability blocks
--
-- Drivers tell the matcher which dates they're NOT available (vacation,
-- personal day, vehicle in shop). The matcher excludes them from
-- scheduling on those dates.
--
-- Stored as a sparse set of blocked dates rather than a continuous range
-- so a driver can block, say, Saturdays + a Tuesday without having to
-- model recurrence. UI is a simple month-grid toggle.
-- =============================================================================

create table driver_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references profiles(id) on delete cascade,
  blocked_date date not null,
  reason text,                                       -- optional free-form note
  created_at timestamptz not null default now(),
  constraint driver_availability_unique_day unique (driver_profile_id, blocked_date)
);

create index driver_availability_driver_idx
  on driver_availability_blocks (driver_profile_id, blocked_date);

alter table driver_availability_blocks enable row level security;

-- Drivers manage their own blocks; dispatchers of the company they belong
-- to can read so the assign picker can warn "this driver is off Saturday."
create policy driver_availability_self on driver_availability_blocks
  for all using (driver_profile_id = auth.uid())
  with check (driver_profile_id = auth.uid());

create policy driver_availability_dispatcher_read on driver_availability_blocks
  for select using (
    exists (
      select 1
      from company_members me
      join company_members them
        on them.company_id = me.company_id
       and them.profile_id = driver_availability_blocks.driver_profile_id
       and them.removed_at is null
      where me.profile_id = auth.uid()
        and me.removed_at is null
        and me.role in ('owner', 'dispatcher')
    )
  );

-- Convenience: helper for the matcher to ask "is driver X available on
-- date Y" without a join. Returns true unless blocked.
create or replace function is_driver_available(
  p_driver_id uuid,
  p_date date
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from driver_availability_blocks
    where driver_profile_id = p_driver_id and blocked_date = p_date
  );
$$;

revoke all on function is_driver_available(uuid, date) from public;
grant execute on function is_driver_available(uuid, date) to authenticated, anon;
