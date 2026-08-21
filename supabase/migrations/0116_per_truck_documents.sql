-- =============================================================================
-- Migration 0116 — documents belong to a truck, and gating follows the truck
--
-- Registration and insurance were company-level: one registration for the whole
-- crew, whatever they drove. That is not how either document works. A
-- registration names a plate and an insurance policy names a vehicle, so a crew
-- with three trucks could get one approved and legally-speaking cover none of
-- the others — while org_can_take_booking (0084) happily unlocked every job.
--
-- After this:
--   • verification_documents.vehicle_id ties a document to one truck
--   • a truck is "road-ready" when ITS registration is approved
--   • fleet capacity for job matching counts only road-ready trucks
--
-- MIGRATION OF EXISTING DOCS. A company with exactly one truck has an
-- unambiguous owner for its existing registration and insurance, so those are
-- attached to it. A company with several trucks does not, and guessing would
-- silently certify trucks nobody reviewed — those documents stay company-level
-- and keep working under the legacy fallback below, which lets an already-
-- approved crew go on working while they attach paperwork per truck.
--
-- Also fixes payments.kind, which allowed only ('deposit','final') and so
-- rejected the standalone tip charges introduced alongside this.
-- =============================================================================

-- ── 1 · Documents can name a truck ──────────────────────────────────────────
alter table verification_documents
  add column if not exists vehicle_id uuid references vehicles(id) on delete cascade;

create index if not exists verification_documents_vehicle_idx
  on verification_documents (vehicle_id) where vehicle_id is not null;

comment on column verification_documents.vehicle_id is
  'The truck this document covers. NULL means a legacy company-wide document (see 0116) or a non-vehicle document such as a driver licence.';

-- Backfill only where it is unambiguous: exactly one truck in the company.
update verification_documents d
   set vehicle_id = v.id
  from vehicles v
 where d.vehicle_id is null
   and d.company_id is not null
   and d.kind in ('vehicle_registration', 'insurance')
   and v.company_id = d.company_id
   and (select count(*) from vehicles v2 where v2.company_id = d.company_id) = 1;

-- ── 2 · payments.kind gains 'tip' ───────────────────────────────────────────
alter table payments drop constraint if exists payments_kind_check;
alter table payments
  add constraint payments_kind_check check (kind in ('deposit', 'final', 'tip'));

-- ── 3 · Is this specific truck allowed to work? ─────────────────────────────
/**
 * A truck is road-ready when its own registration is approved.
 *
 * The legacy fallback matters: crews approved before this migration have a
 * company-level registration and no per-truck one. Requiring per-truck
 * paperwork retroactively would strand every existing crew mid-season with no
 * warning, so a company-wide approved registration still covers a truck that
 * has none of its own. New documents go on the truck, and once a truck has its
 * own registration that document is the one that counts.
 */
create or replace function vehicle_is_road_ready(p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    -- The truck has its own registration on file — it decides, approved or not.
    when exists (
      select 1 from verification_documents d
       where d.vehicle_id = p_vehicle_id and d.kind = 'vehicle_registration'
    ) then exists (
      select 1 from verification_documents d
       where d.vehicle_id = p_vehicle_id
         and d.kind = 'vehicle_registration'
         and d.status = 'approved'
    )
    -- No per-truck registration: fall back to the company's, if approved.
    else exists (
      select 1
        from vehicles v
        join verification_documents d on d.company_id = v.company_id
       where v.id = p_vehicle_id
         and d.vehicle_id is null
         and d.kind = 'vehicle_registration'
         and d.status = 'approved'
    )
  end;
$$;

grant execute on function vehicle_is_road_ready(uuid) to authenticated, service_role;

/**
 * The crew's usable fleet: only trucks cleared to work.
 *
 * This is what job matching must size against. Counting an unapproved truck
 * lets a crew accept a job their only legal vehicle cannot carry — which is the
 * exact failure the registration gate exists to prevent.
 */
create or replace function company_ready_fleet(p_company_id uuid)
returns table (vehicle_id uuid, length_ft int, capacity_cu_ft int)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.length_ft, v.capacity_cu_ft
    from vehicles v
   where v.company_id = p_company_id
     and vehicle_is_road_ready(v.id);
$$;

grant execute on function company_ready_fleet(uuid) to authenticated, service_role;

-- ── 4 · Per-truck document review status, for the app ───────────────────────
/**
 * One row per truck with its document state, so the Trucks screen can show
 * registration and insurance nested under the truck they belong to instead of
 * in a single company-wide box that says nothing about which vehicle it covers.
 */
create or replace function my_fleet_documents()
returns table (
  vehicle_id uuid,
  make text,
  model text,
  year int,
  plate text,
  length_ft int,
  capacity_cu_ft int,
  road_ready boolean,
  registration_status text,
  registration_rejection text,
  registration_is_legacy boolean,
  insurance_status text,
  insurance_rejection text,
  insurance_is_legacy boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select v.*
      from vehicles v
     where exists (
       select 1 from company_members m
        where m.company_id = v.company_id
          and m.profile_id = auth.uid()
          and m.status = 'active'
          and m.removed_at is null
     )
  ),
  doc as (
    select m.id as vid, d.kind, d.status, d.rejection_reason,
           (d.vehicle_id is null) as is_legacy,
           row_number() over (
             partition by m.id, d.kind
             -- A document attached to THIS truck wins over the company-wide
             -- one; newest wins within each of those groups.
             order by (d.vehicle_id is null), d.created_at desc
           ) as rn
      from mine m
      join verification_documents d
        on (d.vehicle_id = m.id or (d.vehicle_id is null and d.company_id = m.company_id))
     where d.kind in ('vehicle_registration', 'insurance')
  )
  select m.id, m.make, m.model, m.year, m.plate, m.length_ft, m.capacity_cu_ft,
         vehicle_is_road_ready(m.id),
         reg.status, reg.rejection_reason, coalesce(reg.is_legacy, false),
         ins.status, ins.rejection_reason, coalesce(ins.is_legacy, false)
    from mine m
    left join doc reg on reg.vid = m.id and reg.kind = 'vehicle_registration' and reg.rn = 1
    left join doc ins on ins.vid = m.id and ins.kind = 'insurance' and ins.rn = 1
   order by m.length_ft desc nulls last, m.created_at;
$$;

grant execute on function my_fleet_documents() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ── 5 · The booking gate now follows the truck ──────────────────────────────
/**
 * Largest truck the crew may actually put on a job.
 *
 * Was `max(length_ft)` across every vehicle row, approved or not — so adding an
 * unapproved 26 ft truck instantly unlocked 26 ft jobs, and the crew turned up
 * in the 16 ft one they were allowed to drive. Capacity now means capacity you
 * are cleared to use.
 */
create or replace function org_max_truck_ft(p_company_id uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(length_ft), 0) from company_ready_fleet(p_company_id);
$$;

create or replace function org_can_take_booking(p_company_id uuid, p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_need int;
  v_have int;
  v_truck_count int;
  v_ready int;
  v_pending int;
begin
  select count(*) into v_truck_count from vehicles where company_id = p_company_id;
  if v_truck_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_truck', 'reason',
      'Add your truck before accepting jobs.');
  end if;

  select count(*) into v_ready from company_ready_fleet(p_company_id);

  if v_ready = 0 then
    -- Distinguish "we haven't looked yet" from "nothing was ever sent". A crew
    -- waiting on review needs to know they're in a queue, not that they missed
    -- a step — that difference is the whole support ticket.
    select count(*) into v_pending
      from verification_documents d
      left join vehicles v on v.id = d.vehicle_id
     where d.kind = 'vehicle_registration'
       and d.status = 'pending'
       and coalesce(v.company_id, d.company_id) = p_company_id;

    if v_pending > 0 then
      return jsonb_build_object('ok', false, 'code', 'registration_pending', 'reason',
        'Your truck registration is waiting on Movvy approval. You can accept jobs as soon as it''s approved.');
    end if;
    return jsonb_build_object('ok', false, 'code', 'registration_missing', 'reason',
      'Upload the registration for at least one truck and get it approved before accepting jobs.');
  end if;

  v_need := required_truck_ft(p_booking_id);
  v_have := org_max_truck_ft(p_company_id);
  if v_need > 0 and v_have < v_need then
    -- Name the real constraint. "Your largest is 16 ft" is confusing to someone
    -- looking at a 26 ft truck in their own fleet list; the reason they can't
    -- use it is that it hasn't been approved, and that is fixable today.
    return jsonb_build_object('ok', false, 'code', 'truck_too_small', 'reason',
      case
        when exists (
          select 1 from vehicles v
           where v.company_id = p_company_id
             and coalesce(v.length_ft, 0) >= v_need
             and not vehicle_is_road_ready(v.id)
        )
        then format(
          'This move needs a %s ft truck. You have one, but its registration isn''t approved yet — your largest approved truck is %s ft.',
          v_need, v_have)
        else format('This move needs a %s ft truck — your largest is %s ft.', v_need, v_have)
      end,
      'required_ft', v_need, 'have_ft', v_have);
  end if;

  return jsonb_build_object('ok', true, 'required_ft', v_need, 'have_ft', v_have);
end $$;

grant execute on function org_max_truck_ft(uuid)           to authenticated, service_role;
grant execute on function org_can_take_booking(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
