-- =============================================================================
-- Migration 0109 — payouts run on a weekly Monday cycle
--
-- Founder decision, and it replaces the "everything collected is claimable
-- today" rule from 0103:
--
--   • A crew can request a payout ONLY on a Monday.
--   • That request covers every completed, collected, unpaid move finishing
--     BEFORE the previous Monday.
--   • Anything not claimed rolls into the next Monday automatically.
--
-- So the lag is 7–14 days depending on which day the move finished. A move
-- completed Sunday is claimable 8 days later; one completed the Monday before
-- that waits 14. That buffer is the point — it leaves room for a card dispute
-- or a customer complaint to surface before Movvy has paid the money out.
--
-- WEEK BOUNDARIES ARE ALBERTA-LOCAL, NOT UTC. date_trunc('week') on a UTC
-- timestamp rolls over at 17:00 or 18:00 Mountain the day before, so a Sunday
-- evening request would have counted as Monday and a genuine Monday-morning one
-- could fall in the wrong week. Every boundary here converts to
-- America/Edmonton first, which also handles the DST shift for free.
--
-- date_trunc('week', ...) is ISO — weeks start Monday — which is exactly the
-- boundary asked for.
-- =============================================================================

-- ── Shared week arithmetic, so nothing can drift ────────────────────────────
-- Three call sites need these numbers: the crew's summary, request_payout's
-- gate, and the admin console's liability table. Computing them in one place
-- means the app and the console can never disagree about what is payable.

/** Monday 00:00 Alberta-local of the current week, as timestamptz. */
create or replace function payout_week_start()
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('week', (now() at time zone 'America/Edmonton'))
          at time zone 'America/Edmonton');
$$;

/** Everything completed strictly BEFORE this instant is payable today.
 *  One week behind the current week's Monday. */
create or replace function payout_cutoff()
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select payout_week_start() - interval '7 days';
$$;

/** Is today a Monday in Alberta? Requests are only accepted then. */
create or replace function payout_is_request_day()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select extract(isodow from (now() at time zone 'America/Edmonton')) = 1;
$$;

/** The next Monday a crew can request on — today if it is Monday. */
create or replace function payout_next_request_day()
returns date language sql stable set search_path = public, pg_temp as $$
  select case
    when payout_is_request_day()
      then (now() at time zone 'America/Edmonton')::date
    else (date_trunc('week', (now() at time zone 'America/Edmonton'))
          + interval '7 days')::date
  end;
$$;

grant execute on function payout_week_start()        to authenticated, service_role;
grant execute on function payout_cutoff()            to authenticated, service_role;
grant execute on function payout_is_request_day()    to authenticated, service_role;
grant execute on function payout_next_request_day()  to authenticated, service_role;

-- ── The crew's own summary ──────────────────────────────────────────────────
create or replace function my_payout_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company_id uuid;
  v_is_admin boolean;
  v_cutoff timestamptz := payout_cutoff();
  v_week_start timestamptz := payout_week_start();
  v_earned bigint := 0;
  v_tips bigint := 0;
  v_not_yet bigint := 0;
  v_penalties bigint := 0;
  v_claimed bigint := 0;
  v_paid bigint := 0;
  v_open jsonb;
  v_requested_this_week boolean := false;
begin
  -- Prefer the org where I am the ADMIN (0103).
  select cm.company_id, cm.org_role = 'admin'
    into v_company_id, v_is_admin
    from company_members cm
   where cm.profile_id = auth.uid()
     and cm.status = 'active'
     and cm.removed_at is null
   order by (cm.org_role = 'admin') desc, cm.accepted_at asc nulls last
   limit 1;

  if v_company_id is null or not coalesce(v_is_admin, false) then
    -- Crew members see nothing; payouts are the admin's (0103).
    return jsonb_build_object(
      'company_id', v_company_id, 'is_org_admin', false, 'can_view', false,
      'available_cents', 0, 'clearing_cents', 0, 'in_hold_cents', 0,
      'tips_cents', 0, 'penalties_cents', 0, 'lifetime_paid_cents', 0,
      'hold_days', 7, 'next_available_at', null, 'open_request', null,
      'is_request_day', payout_is_request_day(),
      'next_request_day', payout_next_request_day(),
      'requested_this_week', false
    );
  end if;

  -- Payable: completed, collected, and finished before the cutoff. No date
  -- floor, so anything a crew never claimed rolls forward on its own.
  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0),
         coalesce(sum(coalesce(b.tip_driver_cents, 0)), 0)
    into v_earned, v_tips
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured'
     and b.completed_at < v_cutoff;

  -- Earned but not yet in the window — shown so a crew can see what's coming
  -- and when, rather than wondering where the money went.
  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)
                    + coalesce(b.tip_driver_cents, 0)), 0)
    into v_not_yet
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured'
     and b.completed_at >= v_cutoff;

  select coalesce(sum(amount_cents), 0) into v_penalties
    from release_penalties where company_id = v_company_id;

  select coalesce(sum(amount_cents), 0) into v_claimed
    from payout_requests
   where company_id = v_company_id and status in ('pending', 'approved', 'paid');

  select coalesce(sum(amount_cents), 0) into v_paid
    from payout_requests where company_id = v_company_id and status = 'paid';

  -- One request per week. Anything raised since this week's Monday counts,
  -- including one already paid, so a crew can't request twice on the same day.
  select exists (
    select 1 from payout_requests
     where company_id = v_company_id
       and status in ('pending', 'approved', 'paid')
       and created_at >= v_week_start
  ) into v_requested_this_week;

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
    'hold_days', 7,
    'available_cents', greatest(0, v_earned + v_tips - v_penalties - v_claimed),
    'clearing_cents', 0,
    -- Completed and collected, but still inside the current window.
    'in_hold_cents', v_not_yet,
    'tips_cents', v_tips,
    'penalties_cents', v_penalties,
    'lifetime_paid_cents', v_paid,
    'next_available_at', null,
    'open_request', v_open,
    'is_request_day', payout_is_request_day(),
    'next_request_day', payout_next_request_day(),
    'requested_this_week', v_requested_this_week
  );
end $$;

grant execute on function my_payout_summary() to authenticated, service_role;

-- ── The gate ────────────────────────────────────────────────────────────────
create or replace function request_payout(p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary jsonb := my_payout_summary();
  v_company_id uuid := (v_summary->>'company_id')::uuid;
  v_amount bigint := coalesce((v_summary->>'available_cents')::bigint, 0);
  v_co record;
  v_id uuid;
begin
  if v_company_id is null then
    raise exception 'You are not part of a crew yet.';
  end if;
  if (v_summary->>'is_org_admin')::boolean is not true then
    raise exception 'Only your crew admin can request a payout.';
  end if;
  if p_method not in ('etransfer', 'bank') then
    raise exception 'Choose e-Transfer or bank deposit.';
  end if;

  -- Mondays only.
  if (v_summary->>'is_request_day')::boolean is not true then
    raise exception 'Payouts are requested on Mondays. Next one: %.',
      to_char(payout_next_request_day(), 'FMDay, FMMonth FMDD');
  end if;

  -- One per week.
  if (v_summary->>'requested_this_week')::boolean is true then
    raise exception 'You have already requested a payout this week. Next one: %.',
      to_char((payout_next_request_day() + interval '7 days')::date, 'FMDay, FMMonth FMDD');
  end if;

  if v_amount <= 0 then
    raise exception 'Nothing to withdraw yet. Moves become payable the second Monday after they finish.';
  end if;

  select * into v_co from companies where id = v_company_id;

  -- Freeze the destination at request time (0092): a mid-flight change of
  -- banking details stays visible instead of silently redirecting the money.
  if p_method = 'etransfer' then
    if coalesce(v_co.etransfer_email, '') = '' then
      raise exception 'Add your e-Transfer email in Profile → Bank details first.';
    end if;
  else
    if coalesce(v_co.bank_account_last4, '') = '' then
      raise exception 'Add your bank account in Profile → Bank details first.';
    end if;
  end if;

  insert into payout_requests (
    company_id, requested_by, amount_cents, method, status,
    etransfer_email, bank_holder_name, bank_institution_number,
    bank_transit_number, bank_account_last4
  ) values (
    v_company_id, auth.uid(), v_amount, p_method, 'pending',
    v_co.etransfer_email, v_co.bank_holder_name, v_co.bank_institution_number,
    v_co.bank_transit_number, v_co.bank_account_last4
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'amount_cents', v_amount);
end $$;

grant execute on function request_payout(text) to authenticated, service_role;

comment on function request_payout(text) is
  'Requests the payable balance for the caller''s org. Admin-only, Mondays only, once per week, covering completed+collected moves finishing before the previous Monday. Unclaimed amounts roll forward (0109).';

-- ── Keep the admin console on the same arithmetic ───────────────────────────
create or replace function admin_crew_balances()
returns table (
  company_id uuid,
  display_name text,
  owed_cents bigint,
  in_hold_cents bigint,
  tips_cents bigint,
  claimed_cents bigint,
  lifetime_paid_cents bigint,
  open_request_id uuid,
  open_request_status text,
  open_request_cents bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with earned as (
    select b.assigned_company_id as cid,
           coalesce(sum(case when b.completed_at < payout_cutoff()
                             then coalesce(b.actual_driver_payout_cents, 0) else 0 end), 0) as earned_cents,
           coalesce(sum(case when b.completed_at < payout_cutoff()
                             then coalesce(b.tip_driver_cents, 0) else 0 end), 0) as tips_cents,
           -- Not yet in the window, so not yet requestable.
           coalesce(sum(case when b.completed_at >= payout_cutoff()
                             then coalesce(b.actual_driver_payout_cents, 0)
                                + coalesce(b.tip_driver_cents, 0) else 0 end), 0) as in_hold_cents
      from bookings b
     where b.assigned_company_id is not null
       and b.status = 'completed'
       and b.payment_status = 'captured'
     group by b.assigned_company_id
  ),
  pen as (
    select company_id as cid, coalesce(sum(amount_cents), 0) as penalties_cents
      from release_penalties group by company_id
  ),
  claimed as (
    select company_id as cid,
           coalesce(sum(case when status in ('pending','approved','paid') then amount_cents else 0 end), 0) as claimed_cents,
           coalesce(sum(case when status = 'paid' then amount_cents else 0 end), 0) as paid_cents
      from payout_requests group by company_id
  ),
  openreq as (
    select distinct on (company_id)
           company_id as cid, id, status::text as status, amount_cents
      from payout_requests
     where status in ('pending', 'approved')
     order by company_id, created_at desc
  )
  select c.id,
         c.display_name,
         greatest(0, coalesce(e.earned_cents, 0) + coalesce(e.tips_cents, 0)
                     - coalesce(p.penalties_cents, 0) - coalesce(cl.claimed_cents, 0))::bigint,
         coalesce(e.in_hold_cents, 0)::bigint,
         coalesce(e.tips_cents, 0)::bigint,
         coalesce(cl.claimed_cents, 0)::bigint,
         coalesce(cl.paid_cents, 0)::bigint,
         o.id, o.status, coalesce(o.amount_cents, 0)::bigint
    from companies c
    left join earned  e  on e.cid  = c.id
    left join pen     p  on p.cid  = c.id
    left join claimed cl on cl.cid = c.id
    left join openreq o  on o.cid  = c.id
   where is_full_admin()
     and (coalesce(e.earned_cents, 0) > 0 or coalesce(e.in_hold_cents, 0) > 0
          or coalesce(cl.claimed_cents, 0) > 0)
   order by 3 desc, c.display_name asc;
$$;

grant execute on function admin_crew_balances() to authenticated, service_role;

notify pgrst, 'reload schema';
