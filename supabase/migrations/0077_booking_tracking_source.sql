-- =============================================================================
-- 0077 — Designated live-location source for a move.
--
-- A move can have more than one crew member on it. The customer's live map
-- follows the newest booking_tracking ping REGARDLESS of who sent it, so if two
-- crew both had the app open the pin would jump between them. This adds
-- bookings.tracking_profile_id — the single crew member whose phone feeds the
-- customer's live location. It's chosen when the crew presses "We've left HQ".
--
-- Falls back to assigned_driver_profile_id when null (single-person moves are
-- unchanged). set_tracking_source lets any active member of the assigned crew
-- pick who the source is (must also be on that crew).
-- =============================================================================

alter table bookings
  add column if not exists tracking_profile_id uuid references profiles(id) on delete set null;

create or replace function set_tracking_source(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select assigned_company_id into v_company from bookings where id = p_booking_id;
  if v_company is null then raise exception 'No crew is assigned to this move yet'; end if;

  if not exists (
    select 1 from company_members
    where company_id = v_company and profile_id = v_uid and status = 'active' and removed_at is null
  ) then
    raise exception 'You are not on this crew';
  end if;

  if not exists (
    select 1 from company_members
    where company_id = v_company and profile_id = p_profile_id and status = 'active' and removed_at is null
  ) then
    raise exception 'That person is not on this crew';
  end if;

  update bookings set tracking_profile_id = p_profile_id where id = p_booking_id;
end $$;

grant execute on function set_tracking_source(uuid, uuid) to authenticated;
