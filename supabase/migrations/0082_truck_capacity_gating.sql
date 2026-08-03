-- =============================================================================
-- 0082 — Truck capacity gating.
--
-- A crew must not be able to accept a move their truck physically can't carry.
-- Until now `vehicles` only had a coarse type enum (cube_van_16 / box_truck_24 /
-- box_truck_26), which can't express the 20 ft and 22 ft bands the matrix needs,
-- so this adds a real length in feet.
--
-- Capacity matrix (mirrored in src/lib/truckFit.ts — keep the two in step):
--   1-bed apartment   16 ft      2-bed house   20 ft
--   2-bed apartment   20 ft      3-bed house   24 ft
--   3-bed apartment   22 ft      4-bed house   26 ft
--
-- It's a MINIMUM, not a match: a 24 ft truck covers its own band and everything
-- smaller. Enforcement lives in bookings-dispatch-accept, which calls
-- org_can_take_booking() below.
-- =============================================================================

alter table vehicles add column if not exists length_ft int;

comment on column vehicles.length_ft is
  'Box length in feet. Drives which moves the org can accept (see truckFit.ts).';

-- Backfill the coarse enum so existing trucks aren't stranded with a null.
update vehicles set length_ft = case type
  when 'cube_van_16'  then 16
  when 'box_truck_24' then 24
  when 'box_truck_26' then 26
  when 'cargo_van'    then 10
  when 'pickup_truck' then 10
  else null
end
where length_ft is null;

-- ── Minimum truck length a booking needs ────────────────────────────────────
create or replace function required_truck_ft(p_booking_id uuid)
returns int language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_type text;
  v_details jsonb;
  v_beds int;
  v_house boolean;
begin
  select move_type::text, coalesce(details, '{}'::jsonb)
    into v_type, v_details
  from bookings where id = p_booking_id;
  if not found then return 0; end if;

  -- Only home moves are truck-gated; office / labour-only / single-item aren't.
  if v_type is distinct from 'home_move' then return 0; end if;

  v_beds  := coalesce((v_details->>'bedrooms')::int, 0);
  v_house := coalesce(v_details->>'dwelling', '') in ('house', 'townhouse');

  if v_house then
    if v_beds >= 4 then return 26; end if;
    if v_beds  = 3 then return 24; end if;
    return 20;
  end if;

  if v_beds >= 4 then return 26; end if;
  if v_beds  = 3 then return 22; end if;
  if v_beds  = 2 then return 20; end if;
  return 16;
end $$;

-- ── Biggest truck an org has on file ────────────────────────────────────────
create or replace function org_max_truck_ft(p_company_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(length_ft), 0) from vehicles where company_id = p_company_id;
$$;

-- ── Can this org accept this booking? ───────────────────────────────────────
-- Returns a jsonb verdict so the edge function can surface a precise reason
-- rather than a generic refusal.
create or replace function org_can_take_booking(p_company_id uuid, p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_need int;
  v_have int;
  v_truck_count int;
  v_reg_count int;
begin
  select count(*) into v_truck_count from vehicles where company_id = p_company_id;
  if v_truck_count = 0 then
    return jsonb_build_object('ok', false, 'reason',
      'Add your truck before accepting jobs.');
  end if;

  -- Proof the truck is theirs. Pending review still counts as submitted so a
  -- new partner isn't frozen out while Movvy reviews — 'rejected' does not.
  select count(*) into v_reg_count
  from verification_documents
  where kind = 'vehicle_registration'
    and status <> 'rejected'
    and (
      company_id = p_company_id
      or profile_id in (
        select profile_id from company_members
        where company_id = p_company_id and removed_at is null
      )
    );
  if v_reg_count = 0 then
    return jsonb_build_object('ok', false, 'reason',
      'Upload your truck registration before accepting jobs.');
  end if;

  v_need := required_truck_ft(p_booking_id);
  v_have := org_max_truck_ft(p_company_id);
  if v_need > 0 and v_have < v_need then
    return jsonb_build_object('ok', false, 'reason',
      format('This move needs a %s ft truck — your largest is %s ft.', v_need, v_have),
      'required_ft', v_need, 'have_ft', v_have);
  end if;

  return jsonb_build_object('ok', true, 'required_ft', v_need, 'have_ft', v_have);
end $$;

grant execute on function required_truck_ft(uuid)          to authenticated, service_role;
grant execute on function org_max_truck_ft(uuid)           to authenticated, service_role;
grant execute on function org_can_take_booking(uuid, uuid) to authenticated, service_role;
