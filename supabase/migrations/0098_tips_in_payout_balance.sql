-- =============================================================================
-- 0097 — Tips are 100% the crew's, and they show up in what a crew can withdraw.
--
-- Movvy takes nothing from a tip (TIP_MOVVY_CUT is now 0 in both engines, which
-- is what makes the "100% of the tip goes to your crew" line — on four app
-- screens AND in the Terms of Service — actually true).
--
-- Tips are collected at checkout and paid out BY HAND, same as the move money.
-- So they have to appear in my_payout_summary or a crew has no way to know
-- there's anything to request. Previously the balance counted only
-- actual_driver_payout_cents, which is computed from the timed bill and excludes
-- the tip entirely — a tipped crew saw nothing.
--
-- A tip rides the same 7-day hold as the move it belongs to: it was charged on
-- the same card, so it carries the same chargeback window.
-- =============================================================================

create or replace function my_payout_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company_id uuid;
  v_is_admin boolean;
  v_hold_days int := 7;
  v_earned bigint := 0;
  v_tips bigint := 0;
  v_held bigint := 0;
  v_held_tips bigint := 0;
  v_penalties bigint := 0;
  v_claimed bigint := 0;
  v_paid bigint := 0;
  v_open jsonb;
  v_next timestamptz;
begin
  select cm.company_id, cm.org_role = 'admin'
    into v_company_id, v_is_admin
  from company_members cm
  where cm.profile_id = auth.uid()
    and cm.status = 'active'
    and cm.removed_at is null
  order by cm.org_role = 'crew' desc
  limit 1;

  if v_company_id is null then
    return jsonb_build_object('company_id', null, 'available_cents', 0, 'is_org_admin', false);
  end if;

  -- Collected, completed, past the hold window. Tips counted separately so the
  -- crew can see them called out.
  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0),
         coalesce(sum(coalesce(b.tip_driver_cents, 0)), 0)
    into v_earned, v_tips
  from bookings b
  where b.assigned_company_id = v_company_id
    and b.status = 'completed'
    and b.payment_status = 'captured'
    and b.completed_at is not null
    and b.completed_at <= now() - (v_hold_days || ' days')::interval;

  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0),
         coalesce(sum(coalesce(b.tip_driver_cents, 0)), 0),
         min(b.completed_at + (v_hold_days || ' days')::interval)
    into v_held, v_held_tips, v_next
  from bookings b
  where b.assigned_company_id = v_company_id
    and b.status = 'completed'
    and b.payment_status = 'captured'
    and b.completed_at is not null
    and b.completed_at > now() - (v_hold_days || ' days')::interval;

  select coalesce(sum(amount_cents), 0) into v_penalties
  from release_penalties where company_id = v_company_id;

  select coalesce(sum(amount_cents), 0) into v_claimed
  from payout_requests
  where company_id = v_company_id and status in ('pending', 'approved', 'paid');

  select coalesce(sum(amount_cents), 0) into v_paid
  from payout_requests
  where company_id = v_company_id and status = 'paid';

  select to_jsonb(r) into v_open
  from (
    select id, amount_cents, method, status, created_at
    from payout_requests
    where company_id = v_company_id and status in ('pending', 'approved')
    order by created_at desc limit 1
  ) r;

  return jsonb_build_object(
    'company_id', v_company_id,
    'is_org_admin', coalesce(v_is_admin, false),
    'hold_days', v_hold_days,
    'available_cents', greatest(0, v_earned + v_tips - v_penalties - v_claimed),
    'clearing_cents', v_held + v_held_tips,
    'tips_cents', v_tips,
    'next_available_at', v_next,
    'penalties_cents', v_penalties,
    'lifetime_paid_cents', v_paid,
    'open_request', v_open
  );
end $$;

grant execute on function my_payout_summary() to authenticated;
