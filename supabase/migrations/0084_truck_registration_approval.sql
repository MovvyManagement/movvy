-- =============================================================================
-- 0084 — Truck registration must be APPROVED by a Movvy admin.
--
-- 0082 let a merely-submitted registration through so a new partner wasn't
-- frozen out during review. The real policy is stricter: an admin reviews the
-- document, approves it or rejects it with a comment, and only an APPROVED
-- registration unlocks job acceptance. The partner sees the status (and the
-- rejection comment) in their profile and can re-upload.
--
-- verification_documents already carries status / reviewed_by / reviewed_at /
-- rejection_reason — nothing new to store.
-- =============================================================================

create or replace function org_can_take_booking(p_company_id uuid, p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_need int;
  v_have int;
  v_truck_count int;
  v_approved int;
  v_pending int;
begin
  select count(*) into v_truck_count from vehicles where company_id = p_company_id;
  if v_truck_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_truck', 'reason',
      'Add your truck before accepting jobs.');
  end if;

  -- Registration must be reviewed AND approved.
  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'pending')
  into v_approved, v_pending
  from verification_documents
  where kind = 'vehicle_registration'
    and (
      company_id = p_company_id
      or profile_id in (
        select profile_id from company_members
        where company_id = p_company_id and removed_at is null
      )
    );

  if v_approved = 0 then
    if v_pending > 0 then
      return jsonb_build_object('ok', false, 'code', 'registration_pending', 'reason',
        'Your truck registration is waiting on Movvy approval. You can accept jobs as soon as it''s approved.');
    end if;
    return jsonb_build_object('ok', false, 'code', 'registration_missing', 'reason',
      'Upload your truck registration and get it approved before accepting jobs.');
  end if;

  v_need := required_truck_ft(p_booking_id);
  v_have := org_max_truck_ft(p_company_id);
  if v_need > 0 and v_have < v_need then
    return jsonb_build_object('ok', false, 'code', 'truck_too_small', 'reason',
      format('This move needs a %s ft truck — your largest is %s ft.', v_need, v_have),
      'required_ft', v_need, 'have_ft', v_have);
  end if;

  return jsonb_build_object('ok', true, 'required_ft', v_need, 'have_ft', v_have);
end $$;

grant execute on function org_can_take_booking(uuid, uuid) to authenticated, service_role;

-- ── What the partner sees in their own profile ──────────────────────────────
-- Their truck-registration state + the reviewer's comment, so the app can show
-- "Pending approval" / "Changes requested: …" and offer a re-upload.
create or replace function my_truck_registration_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (
      select jsonb_build_object(
        'status', d.status::text,
        'rejection_reason', d.rejection_reason,
        'reviewed_at', d.reviewed_at,
        'created_at', d.created_at
      )
      from verification_documents d
      where d.kind = 'vehicle_registration'
        and (
          d.profile_id = auth.uid()
          or d.company_id in (
            select company_id from company_members
            where profile_id = auth.uid() and removed_at is null
          )
        )
      -- Approved wins; otherwise show the most recent submission.
      order by (d.status = 'approved') desc, d.created_at desc
      limit 1
    ),
    jsonb_build_object('status', 'missing')
  );
$$;

grant execute on function my_truck_registration_status() to authenticated;
