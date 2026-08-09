-- =============================================================================
-- Migration 0103 — payouts: admin's money, admin's eyes, no blocking hold
--
-- Three founder decisions:
--
--  1. A crew MEMBER must not see the crew's balance. Only the crew admin does.
--     Today my_payout_summary hands every member the org's full financial
--     position — earnings, tips, penalties, lifetime paid — even though only an
--     admin can act on it.
--
--  2. Money that has been earned and collected but not yet paid out should be
--     requestable, even if the 7-day hold hasn't elapsed. The hold stays as
--     information, not a lock.
--
--  3. The org is resolved by ADMIN membership, not by joined crew.
--
-- (3) also fixes a real bug. The old resolution was:
--
--     order by cm.org_role = 'crew' desc limit 1
--
-- which DELIBERATELY preferred a joined-crew membership. Someone who runs their
-- own crew and also works weekends in another crew got the OTHER company's
-- balance with is_org_admin false, so request_payout refused them with "Only
-- your crew admin can request a payout" — their own company's earnings were
-- unwithdrawable until they left the other crew. Preferring the admin
-- membership is both the fix and the rule that makes "the banking details on a
-- job are always the admin's" true.
--
-- What is NOT changed: money must still be COLLECTED before it can be paid out
-- (payment_status = 'captured'). Removing the hold is a timing decision; paying
-- out money Stripe never captured would be paying with nothing.
-- =============================================================================

create or replace function my_payout_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_hold_days int := 7;
  v_company_id uuid;
  v_is_admin boolean;
  v_earned bigint := 0;
  v_tips bigint := 0;
  v_in_hold bigint := 0;
  v_penalties bigint := 0;
  v_claimed bigint := 0;
  v_paid bigint := 0;
  v_next timestamptz;
  v_open jsonb;
begin
  -- Prefer the org where I am the ADMIN. A crew-only membership still resolves,
  -- so the caller gets a truthful "you're not the admin" answer rather than a
  -- null company.
  select cm.company_id, cm.org_role = 'admin'
    into v_company_id, v_is_admin
    from company_members cm
   where cm.profile_id = auth.uid()
     and cm.status = 'active'
     and cm.removed_at is null
   order by (cm.org_role = 'admin') desc, cm.accepted_at asc nulls last
   limit 1;

  if v_company_id is null then
    return jsonb_build_object(
      'company_id', null, 'is_org_admin', false, 'can_view', false,
      'available_cents', 0, 'clearing_cents', 0, 'tips_cents', 0,
      'penalties_cents', 0, 'lifetime_paid_cents', 0,
      'hold_days', v_hold_days, 'next_available_at', null, 'open_request', null
    );
  end if;

  -- ── Crew members see nothing ────────────────────────────────────────────
  -- Payouts belong to the org and settle to the admin's banking details, so a
  -- crew member has no business seeing the balance. can_view lets the app draw
  -- an honest "your crew admin handles payouts" panel instead of zeros that
  -- look like an empty wallet.
  if not coalesce(v_is_admin, false) then
    return jsonb_build_object(
      'company_id', v_company_id, 'is_org_admin', false, 'can_view', false,
      'available_cents', 0, 'clearing_cents', 0, 'tips_cents', 0,
      'penalties_cents', 0, 'lifetime_paid_cents', 0,
      'hold_days', v_hold_days, 'next_available_at', null, 'open_request', null
    );
  end if;

  -- ── Everything earned and collected, hold or no hold ────────────────────
  select coalesce(sum(b.actual_driver_payout_cents), 0),
         coalesce(sum(b.tip_driver_cents), 0)
    into v_earned, v_tips
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured';

  -- Still inside the hold window — reported for information only. It is
  -- INCLUDED in available_cents above, because the founder's rule is that
  -- earned, collected, unpaid money can be requested now.
  select coalesce(sum(b.actual_driver_payout_cents + coalesce(b.tip_driver_cents, 0)), 0),
         min(b.completed_at + (v_hold_days || ' days')::interval)
    into v_in_hold, v_next
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured'
     and b.completed_at > now() - (v_hold_days || ' days')::interval;

  -- release_penalties is the real table (0098 reads it the same way; there is
  -- no partner_penalties).
  select coalesce(sum(amount_cents), 0) into v_penalties
    from release_penalties where company_id = v_company_id;

  -- Anything already requested, however far along, is spoken for.
  select coalesce(sum(amount_cents), 0) into v_claimed
    from payout_requests
   where company_id = v_company_id and status in ('pending', 'approved', 'paid');

  select coalesce(sum(amount_cents), 0) into v_paid
    from payout_requests where company_id = v_company_id and status = 'paid';

  select to_jsonb(pr) into v_open
    from payout_requests pr
   where pr.company_id = v_company_id
     and pr.status in ('pending', 'approved')
   order by pr.created_at desc
   limit 1;

  return jsonb_build_object(
    'company_id', v_company_id,
    'is_org_admin', true,
    'can_view', true,
    'hold_days', v_hold_days,
    -- Requestable now: earned + tips − penalties − already claimed.
    'available_cents', greatest(0, v_earned + v_tips - v_penalties - v_claimed),
    -- No longer a separate locked bucket; kept at 0 so any older client that
    -- adds available + clearing can't double-count.
    'clearing_cents', 0,
    'in_hold_cents', v_in_hold,
    'tips_cents', v_tips,
    'penalties_cents', v_penalties,
    'lifetime_paid_cents', v_paid,
    'next_available_at', v_next,
    'open_request', v_open
  );
end $$;

grant execute on function my_payout_summary() to authenticated, service_role;

-- ── request_payout must agree ───────────────────────────────────────────────
-- It reads my_payout_summary for the amount and the admin flag, so it inherits
-- both changes: a crew member is refused (is_org_admin false) and an admin can
-- draw against money still inside the hold window.
--
-- Nothing to change in its body — but re-assert the comment so the next reader
-- doesn't "fix" the hold back in.
comment on function request_payout(text) is
  'Requests the full available balance for the caller''s org. Admin-only. Money must be collected (payment_status=captured) but need NOT have cleared the 7-day hold — the hold is informational (0103).';

notify pgrst, 'reload schema';
