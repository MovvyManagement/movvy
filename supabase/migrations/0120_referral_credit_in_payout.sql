-- =============================================================================
-- Migration 0120 — referral credit is withdrawable at payout (partner side)
--
-- Customers already spend referral credit automatically at checkout
-- (redeem_credit_for_booking, 0112). Partners — crew admins and solo operators —
-- don't book moves, so their earned referral credit (account_credits) had no way
-- out. This makes it part of what an org admin can withdraw at payout, alongside
-- their earnings.
--
-- Design:
--   • my_payout_summary adds the signed-in ADMIN's personal credit balance to
--     available_cents, and reports it as credit_cents. It sits OUTSIDE the
--     greatest(0, …) around earnings, so promo credit is always fully
--     withdrawable and can never be silently eaten by a release penalty or a
--     prior claim.
--   • request_payout locks the admin's credit ledger, re-reads the balance under
--     the lock, includes it in the payout, and writes a matching negative
--     'redemption' row. That single ledger is also what redeem_credit_for_booking
--     reads, so credit can never be both withdrawn AND applied to a move.
--
-- Crew MEMBERS still can't request payouts (unchanged) — but any referral credit
-- they earn is still spendable the customer way, on a move they book themselves.
--
-- account_credits is profile-scoped; payouts are org-scoped and settle to the
-- admin's banking details. Attaching the admin's personal credit to the org
-- payout is deliberate: the admin is the one who withdraws, so it's their credit
-- that rides along.
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
  v_credit bigint := 0;
  v_next timestamptz;
  v_open jsonb;
begin
  select cm.company_id, cm.org_role = 'admin'
    into v_company_id, v_is_admin
    from company_members cm
   where cm.profile_id = auth.uid()
     and cm.status = 'active'
     and cm.removed_at is null
   order by (cm.org_role = 'admin') desc, cm.accepted_at asc nulls last
   limit 1;

  -- Personal referral/promo credit for the signed-in admin. Clamp at 0 so a
  -- net-negative ledger (shouldn't happen, but be safe) can never reduce a
  -- payout.
  select greatest(0, coalesce(sum(amount_cents), 0)) into v_credit
    from account_credits where profile_id = auth.uid();

  if v_company_id is null then
    return jsonb_build_object(
      'company_id', null, 'is_org_admin', false, 'can_view', false,
      'available_cents', 0, 'clearing_cents', 0, 'tips_cents', 0,
      'penalties_cents', 0, 'lifetime_paid_cents', 0, 'credit_cents', 0,
      'hold_days', v_hold_days, 'next_available_at', null, 'open_request', null
    );
  end if;

  -- Crew members see nothing (payouts are the admin's).
  if not coalesce(v_is_admin, false) then
    return jsonb_build_object(
      'company_id', v_company_id, 'is_org_admin', false, 'can_view', false,
      'available_cents', 0, 'clearing_cents', 0, 'tips_cents', 0,
      'penalties_cents', 0, 'lifetime_paid_cents', 0, 'credit_cents', 0,
      'hold_days', v_hold_days, 'next_available_at', null, 'open_request', null
    );
  end if;

  select coalesce(sum(b.actual_driver_payout_cents), 0),
         coalesce(sum(b.tip_driver_cents), 0)
    into v_earned, v_tips
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured';

  select coalesce(sum(b.actual_driver_payout_cents + coalesce(b.tip_driver_cents, 0)), 0),
         min(b.completed_at + (v_hold_days || ' days')::interval)
    into v_in_hold, v_next
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured'
     and b.completed_at > now() - (v_hold_days || ' days')::interval;

  select coalesce(sum(amount_cents), 0) into v_penalties
    from release_penalties where company_id = v_company_id;

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
    -- Earnings (earned + tips − penalties − already claimed), clamped at 0, then
    -- personal referral credit added on top. Credit is OUTSIDE the greatest() so
    -- it stays fully withdrawable and is never eaten by a penalty or prior claim.
    'available_cents', greatest(0, v_earned + v_tips - v_penalties - v_claimed) + v_credit,
    'clearing_cents', 0,
    'in_hold_cents', v_in_hold,
    'tips_cents', v_tips,
    'penalties_cents', v_penalties,
    'lifetime_paid_cents', v_paid,
    'credit_cents', v_credit,
    'next_available_at', v_next,
    'open_request', v_open
  );
end $$;

grant execute on function my_payout_summary() to authenticated, service_role;

-- ── request_payout: include + spend the credit ──────────────────────────────
create or replace function request_payout(p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary jsonb := my_payout_summary();
  v_company_id uuid := (v_summary->>'company_id')::uuid;
  v_amount int := (v_summary->>'available_cents')::int;
  v_credit int := coalesce((v_summary->>'credit_cents')::int, 0);
  v_credit_now int;
  v_credit_redeem int;
  v_co companies;
  v_id uuid;
begin
  if v_company_id is null then
    raise exception 'You are not part of a crew.';
  end if;
  if (v_summary->>'is_org_admin')::boolean is not true then
    raise exception 'Only your crew admin can request a payout.';
  end if;
  if v_summary->'open_request' is not null and v_summary->'open_request' <> 'null'::jsonb then
    raise exception 'You already have a payout request in progress.';
  end if;
  if p_method not in ('etransfer', 'bank') then
    raise exception 'Choose e-Transfer or bank deposit.';
  end if;

  -- Lock this admin's credit ledger and re-read under the lock so a payout and a
  -- move-checkout can't spend the same credit. Only redeem what's actually there
  -- now; if some was spent between the summary snapshot and this lock, trim the
  -- payout by that difference so we never pay out credit we can't mark spent.
  perform 1 from account_credits where profile_id = auth.uid() for update;
  select greatest(0, coalesce(sum(amount_cents), 0)) into v_credit_now
    from account_credits where profile_id = auth.uid();
  v_credit_redeem := least(v_credit, v_credit_now);
  if v_credit > v_credit_redeem then
    v_amount := v_amount - (v_credit - v_credit_redeem);
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Nothing available to withdraw yet.';
  end if;

  select * into v_co from companies where id = v_company_id;

  if p_method = 'etransfer' and coalesce(v_co.etransfer_email, '') = '' then
    raise exception 'Add your e-Transfer email in Profile → Bank details first.';
  end if;
  if p_method = 'bank' and coalesce(v_co.bank_account_last4, '') = '' then
    raise exception 'Add your bank details in Profile → Bank details first.';
  end if;

  insert into payout_requests (
    company_id, requested_by, amount_cents, method,
    etransfer_email, bank_holder_name, bank_institution_number,
    bank_transit_number, bank_account_last4
  ) values (
    v_company_id, auth.uid(), v_amount, p_method,
    v_co.etransfer_email, v_co.bank_holder_name, v_co.bank_institution_number,
    v_co.bank_transit_number, v_co.bank_account_last4
  ) returning id into v_id;

  -- Spend the credit that rode along in this payout. Booking-less redemption
  -- row (the one-redemption-per-booking unique index only covers rows with a
  -- booking_id, so multiple null-booking redemptions are fine).
  if v_credit_redeem > 0 then
    insert into account_credits (profile_id, amount_cents, kind, booking_id, note)
    values (auth.uid(), -v_credit_redeem, 'redemption', null,
            'Withdrawn with payout ' || v_id::text);
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'amount_cents', v_amount, 'credit_cents', v_credit_redeem
  );
end $$;

grant execute on function request_payout(text) to authenticated;

notify pgrst, 'reload schema';
