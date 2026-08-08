-- =============================================================================
-- 0092 — Crews request their money; Movvy pays it by hand.
--
-- There is no automated payout rail, and pretending otherwise would be worse
-- than not having one. So the flow is explicit: a crew admin sees what they've
-- earned, requests it, and the request lands on the ops console with the
-- banking details attached. Someone sends the e-Transfer and marks it paid.
--
-- WHAT COUNTS AS AVAILABLE
--   • the move is completed
--   • the customer's card actually captured — we never pay out money we
--     haven't collected
--   • completion was at least PAYOUT_HOLD_DAYS (7) ago — the window where a
--     dispute, chargeback or damage claim would surface
--   • minus release penalties the org owes
--   • minus anything already requested, approved or paid
--
-- WHY THE BANKING DETAILS ARE SNAPSHOTTED
-- An attacker who takes over a crew account could change the e-Transfer email
-- and immediately request a withdrawal. Freezing the destination at request
-- time means the ops console shows where the money was meant to go when the
-- request was made, and a mid-flight change of details is visible rather than
-- silent. If a crew genuinely changes banks, they cancel and re-request.
-- =============================================================================

do $$ begin
  create type payout_request_status as enum ('pending', 'approved', 'paid', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists payout_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  requested_by uuid references profiles(id) on delete set null,

  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('etransfer', 'bank')),

  -- Destination, frozen at request time. See header.
  etransfer_email text,
  bank_holder_name text,
  bank_institution_number text,
  bank_transit_number text,
  bank_account_last4 text,

  status payout_request_status not null default 'pending',
  admin_note text,
  /** Whatever the operator wants to record — e-Transfer confirmation, wire ref. */
  reference text,
  processed_by uuid references profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payout_requests_pending_idx
  on payout_requests (created_at desc) where status = 'pending';
create index if not exists payout_requests_company_idx
  on payout_requests (company_id, created_at desc);

-- One open request at a time per org — otherwise an org could request the same
-- balance five times before anyone looks at the queue.
create unique index if not exists payout_requests_one_open_per_company
  on payout_requests (company_id) where status in ('pending', 'approved');

alter table payout_requests enable row level security;

-- A crew admin sees their own org's requests. Movvy staff see everything.
drop policy if exists payout_requests_read on payout_requests;
create policy payout_requests_read on payout_requests for select
  using (is_company_admin(company_id) or is_admin());

-- Writes go through request_payout() / the admin console only.
drop policy if exists payout_requests_admin_write on payout_requests;
create policy payout_requests_admin_write on payout_requests for all
  using (is_admin()) with check (is_admin());

-- ── What can this org withdraw right now? ───────────────────────────────────
create or replace function my_payout_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company_id uuid;
  v_is_admin boolean;
  v_hold_days int := 7;
  v_earned bigint := 0;
  v_held bigint := 0;
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

  -- Collected, completed, and past the hold window.
  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0)
    into v_earned
  from bookings b
  where b.assigned_company_id = v_company_id
    and b.status = 'completed'
    and b.payment_status = 'captured'
    and b.completed_at is not null
    and b.completed_at <= now() - (v_hold_days || ' days')::interval;

  -- Collected but still inside the hold window — shown so the crew can see
  -- money coming rather than wondering where it went.
  select coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0),
         min(b.completed_at + (v_hold_days || ' days')::interval)
    into v_held, v_next
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
    'available_cents', greatest(0, v_earned - v_penalties - v_claimed),
    'clearing_cents', v_held,
    'next_available_at', v_next,
    'penalties_cents', v_penalties,
    'lifetime_paid_cents', v_paid,
    'open_request', v_open
  );
end $$;

grant execute on function my_payout_summary() to authenticated;

-- ── Request it ──────────────────────────────────────────────────────────────
-- Admin-only: the org admin owns the banking relationship, and crew never see
-- money figures at all. Amount is decided HERE, never passed in by the client.
create or replace function request_payout(p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary jsonb := my_payout_summary();
  v_company_id uuid := (v_summary->>'company_id')::uuid;
  v_amount int := (v_summary->>'available_cents')::int;
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
  if v_amount is null or v_amount <= 0 then
    raise exception 'Nothing available to withdraw yet.';
  end if;
  if p_method not in ('etransfer', 'bank') then
    raise exception 'Choose e-Transfer or bank deposit.';
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

  return jsonb_build_object('ok', true, 'id', v_id, 'amount_cents', v_amount);
end $$;

grant execute on function request_payout(text) to authenticated;

-- A crew can withdraw a request while it's still pending.
create or replace function cancel_payout_request(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payout_requests
     set status = 'cancelled', processed_at = now()
   where id = p_id
     and status = 'pending'
     and is_company_admin(company_id);
  if not found then
    raise exception 'That request can no longer be cancelled.';
  end if;
end $$;

grant execute on function cancel_payout_request(uuid) to authenticated;
