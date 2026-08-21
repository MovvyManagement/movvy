-- =============================================================================
-- Migration 0114 — everything Movvy needs to actually pay a crew
--
-- Three gaps, all found when the question "who do I owe, and where does the
-- money go?" turned out to have no single place to answer it.
--
-- 1. A PAYOUT REQUEST DIDN'T SAY WHAT IT WAS FOR. It froze the destination
--    (0092) but nothing about the work: no crew size, no tips split out, no
--    job count, and no statement of which week it covers. Whoever pays it was
--    looking at a name and a number and asked to trust both.
--
-- 2. THERE WAS NO CREW DIRECTORY. admin_crew_balances() only returns crews with
--    activity, by design — it drives the "owed" queue. A crew that has banking
--    on file and hasn't worked yet, or one whose balance is zero because it was
--    just paid, is invisible. That is the wrong shape for a page whose job is
--    "show me every crew and where their money goes".
--
-- 3. A BANKING CHANGE LEFT NO TRACE. companies.bank_updated_at existed and was
--    never written by anything, and nothing recorded WHO changed WHAT. Payment
--    destinations are the one field on this table worth an audit trail: it is
--    the field an attacker with a session, or a crew member with a grudge,
--    would change.
--
-- Full account numbers are NOT stored anywhere in this schema — only last4,
-- institution and transit — and this migration does not start storing them.
-- The log records what changed, not a copy of the credentials.
-- =============================================================================

-- ── 1 · A payout request states its own case ────────────────────────────────
alter table payout_requests
  add column if not exists crew_size    int,
  add column if not exists tips_cents   bigint not null default 0,
  add column if not exists jobs_count   int,
  add column if not exists period_start date,
  add column if not exists period_end   date;

comment on column payout_requests.crew_size is
  'Active members of the crew at request time. Snapshot, not a live join — the roster changes and a paid request must keep saying what it said when it was paid.';
comment on column payout_requests.tips_cents is
  'Portion of amount_cents that is customer tips. Tips are 100% the crew''s, so this is shown separately rather than folded into the payout figure.';
comment on column payout_requests.period_end is
  'Last day of work covered. Everything completing on or before this date is in the request; later work rolls to the next Monday.';

-- ── 2 · Record every change of a payment destination ────────────────────────
create table if not exists company_bank_changes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  changed_by   uuid references profiles(id) on delete set null,
  changed_at   timestamptz not null default now(),
  /** Which of the destination fields moved, e.g. {bank_transit_number, etransfer_email}. */
  fields       text[] not null,
  /** Human-readable before/after for each field. Account numbers are last4
   *  only, because last4 is all this schema has ever held. */
  before       jsonb not null default '{}'::jsonb,
  after        jsonb not null default '{}'::jsonb
);

create index if not exists company_bank_changes_company_idx
  on company_bank_changes (company_id, changed_at desc);

alter table company_bank_changes enable row level security;

-- The crew admin can see their own history — being able to check "did someone
-- change where my money goes" is the point of keeping it. Movvy admins see all.
create policy company_bank_changes_read on company_bank_changes for select
  using (is_admin() or is_company_admin(company_id));

/**
 * Stamp bank_updated_at and write one log row whenever a destination field
 * moves. Attached to companies rather than done in application code so it
 * cannot be bypassed: the app writes these fields directly through PostgREST,
 * and a second write path (or a fix-up from the SQL editor) would otherwise
 * leave no trace.
 */
create or replace function companies_log_bank_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fields text[] := '{}';
  v_before jsonb  := '{}'::jsonb;
  v_after  jsonb  := '{}'::jsonb;
  v_col    text;
  v_old    text;
  v_new    text;
begin
  foreach v_col in array array[
    'bank_holder_name', 'bank_institution_number', 'bank_transit_number',
    'bank_account_last4', 'etransfer_email', 'payout_currency'
  ] loop
    v_old := to_jsonb(old) ->> v_col;
    v_new := to_jsonb(new) ->> v_col;
    if v_old is distinct from v_new then
      v_fields := v_fields || v_col;
      v_before := v_before || jsonb_build_object(v_col, v_old);
      v_after  := v_after  || jsonb_build_object(v_col, v_new);
    end if;
  end loop;

  if array_length(v_fields, 1) is null then
    return new;   -- nothing to do with money changed
  end if;

  new.bank_updated_at := now();

  insert into company_bank_changes (company_id, changed_by, fields, before, after)
  values (new.id, auth.uid(), v_fields, v_before, v_after);

  return new;
end $$;

drop trigger if exists companies_bank_change on companies;
create trigger companies_bank_change
  before update on companies
  for each row execute function companies_log_bank_change();

-- ── 3 · Populate the new snapshot on request ────────────────────────────────
create or replace function request_payout(p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_summary jsonb := my_payout_summary();
  v_company_id uuid := (v_summary->>'company_id')::uuid;
  v_amount bigint := coalesce((v_summary->>'available_cents')::bigint, 0);
  v_co record;
  v_id uuid;
  v_crew int;
  v_tips bigint;
  v_jobs int;
  v_first date;
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

  if (v_summary->>'is_request_day')::boolean is not true then
    raise exception 'Payouts are requested on Mondays. Next one: %.',
      to_char(payout_next_request_day(), 'FMDay, FMMonth FMDD');
  end if;

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

  -- Freeze the WORK too, not just the destination. Same reasoning: whoever
  -- approves this a week later needs to see what they are paying for without
  -- re-deriving it from a roster and a booking list that have both moved on.
  select count(*) into v_crew
    from company_members m
   where m.company_id = v_company_id
     and m.status = 'active'
     and m.removed_at is null;

  select coalesce(sum(coalesce(b.tip_driver_cents, 0)), 0),
         count(*),
         min(b.completed_at::date)
    into v_tips, v_jobs, v_first
    from bookings b
   where b.assigned_company_id = v_company_id
     and b.status = 'completed'
     and b.payment_status = 'captured'
     and b.completed_at < payout_cutoff();

  insert into payout_requests (
    company_id, requested_by, amount_cents, method, status,
    etransfer_email, bank_holder_name, bank_institution_number,
    bank_transit_number, bank_account_last4,
    crew_size, tips_cents, jobs_count, period_start, period_end
  ) values (
    v_company_id, auth.uid(), v_amount, p_method, 'pending',
    v_co.etransfer_email, v_co.bank_holder_name, v_co.bank_institution_number,
    v_co.bank_transit_number, v_co.bank_account_last4,
    v_crew, coalesce(v_tips, 0), coalesce(v_jobs, 0),
    v_first, (payout_cutoff() - interval '1 day')::date
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'amount_cents', v_amount);
end $$;

grant execute on function request_payout(text) to authenticated, service_role;

-- ── 4 · The crew payout directory ───────────────────────────────────────────
/**
 * Every crew Movvy might owe money to, whether or not it currently has a
 * balance — the deliberate difference from admin_crew_balances(), which filters
 * to crews with activity because it drives the "owed" queue.
 *
 * This is the page you open to answer "where does this crew's money go, who is
 * on it, and when did their banking last change".
 */
create or replace function admin_crew_payout_directory()
returns table (
  company_id uuid,
  display_name text,
  legal_name text,
  email text,
  phone text,
  hq_city_name text,
  onboarding_status text,
  suspended_at timestamptz,
  crew_size int,
  admin_count int,
  member_count int,
  payout_method text,
  etransfer_email text,
  bank_holder_name text,
  bank_institution_number text,
  bank_transit_number text,
  bank_account_last4 text,
  bank_updated_at timestamptz,
  bank_change_count int,
  jobs_completed int,
  owed_cents bigint,
  in_hold_cents bigint,
  tips_cents bigint,
  penalties_cents bigint,
  claimed_cents bigint,
  lifetime_paid_cents bigint,
  open_request_id uuid,
  open_request_status text,
  open_request_cents bigint,
  last_paid_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with roster as (
    select company_id as cid,
           count(*)::int as crew_size,
           count(*) filter (where org_role = 'admin')::int as admin_count,
           count(*) filter (where org_role <> 'admin')::int as member_count
      from company_members
     where status = 'active' and removed_at is null
     group by company_id
  ),
  earned as (
    -- Same arithmetic as admin_crew_balances / my_payout_summary. Three places
    -- computing a crew's balance three ways is how a console and an app end up
    -- disagreeing about what someone is owed.
    select b.assigned_company_id as cid,
           count(*)::int as jobs_completed,
           coalesce(sum(case when b.completed_at < payout_cutoff()
                             then coalesce(b.actual_driver_payout_cents, 0) else 0 end), 0) as earned_cents,
           coalesce(sum(case when b.completed_at < payout_cutoff()
                             then coalesce(b.tip_driver_cents, 0) else 0 end), 0) as tips_cents,
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
           coalesce(sum(case when status = 'paid' then amount_cents else 0 end), 0) as paid_cents,
           max(case when status = 'paid' then processed_at end) as last_paid_at
      from payout_requests group by company_id
  ),
  openreq as (
    select distinct on (company_id)
           company_id as cid, id, status::text as status, amount_cents
      from payout_requests
     where status in ('pending', 'approved')
     order by company_id, created_at desc
  ),
  banklog as (
    select company_id as cid, count(*)::int as n
      from company_bank_changes group by company_id
  )
  select c.id,
         c.display_name,
         c.legal_name,
         c.email,
         c.phone,
         c.hq_city_name,
         c.onboarding_status,
         c.suspended_at,
         coalesce(r.crew_size, 0),
         coalesce(r.admin_count, 0),
         coalesce(r.member_count, 0),
         -- What they'd actually be paid through, inferred from what is on file.
         case
           when coalesce(c.bank_account_last4, '') <> '' then 'bank'
           when coalesce(c.etransfer_email, '') <> ''   then 'etransfer'
           else 'none'
         end,
         c.etransfer_email,
         c.bank_holder_name,
         c.bank_institution_number,
         c.bank_transit_number,
         c.bank_account_last4,
         c.bank_updated_at,
         coalesce(bl.n, 0),
         coalesce(e.jobs_completed, 0),
         greatest(0, coalesce(e.earned_cents, 0) + coalesce(e.tips_cents, 0)
                     - coalesce(p.penalties_cents, 0) - coalesce(cl.claimed_cents, 0))::bigint,
         coalesce(e.in_hold_cents, 0)::bigint,
         coalesce(e.tips_cents, 0)::bigint,
         coalesce(p.penalties_cents, 0)::bigint,
         coalesce(cl.claimed_cents, 0)::bigint,
         coalesce(cl.paid_cents, 0)::bigint,
         o.id, o.status, coalesce(o.amount_cents, 0)::bigint,
         cl.last_paid_at
    from companies c
    left join roster  r  on r.cid  = c.id
    left join earned  e  on e.cid  = c.id
    left join pen     p  on p.cid  = c.id
    left join claimed cl on cl.cid = c.id
    left join openreq o  on o.cid  = c.id
    left join banklog bl on bl.cid = c.id
   where is_full_admin()
     and c.deleted_at is null
   order by 21 desc, c.display_name asc;   -- owed_cents, then name
$$;

grant execute on function admin_crew_payout_directory() to authenticated, service_role;

comment on function admin_crew_payout_directory() is
  'Every crew with payout destination, roster size, balances and banking-change history. Management-only (is_full_admin). Unlike admin_crew_balances() it does not filter to crews with activity.';

notify pgrst, 'reload schema';
