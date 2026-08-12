-- =============================================================================
-- Migration 0110 — referral credits that are real, and paid for the right event
--
-- Two things were wrong with referrals before this.
--
-- 1. THE CREDIT DIDN'T EXIST. `referrals.credit_cents` was a number on a row.
--    Nothing summed it, nobody could see it, and there was no way to spend it.
--    The Invite screen promised money the system had no concept of.
--
-- 2. IT PAID AT THE WRONG MOMENT. 0032 flipped a referral to 'applied' on the
--    invitee's first booking INSERT — before any money moved. A booking is
--    inserted as 'draft' and only becomes real when the deposit is captured, so
--    the old trigger paid out for abandoned checkouts and for drafts that were
--    never submitted at all.
--
-- Founder's rules, implemented here:
--   • Customer referral — $75 each side, when the invitee BOOKS AND PAYS
--     (deposit_status = 'paid').
--   • Driver referral   — $50 each side, when the invitee COMPLETES a job.
--
-- Which rule applies is decided by what the invitee actually DID, not by what
-- anyone intended at signup. Someone invited as a customer who ends up
-- completing moves earns the driver reward; the event is the truth. That also
-- means `kind` and `credit_cents` are stamped at award time rather than being
-- guessed when the code is entered.
--
-- Both sides are paid exactly once per referral, enforced by a unique index
-- rather than by trigger logic being careful.
-- =============================================================================

-- ── The ledger ──────────────────────────────────────────────────────────────
-- Entries, not a balance column. A running total invites double-writes and
-- silent drift; a ledger can always be re-derived and audited, and negative
-- rows give redemptions somewhere to live when credits become spendable.
create table if not exists account_credits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  /** Positive = earned, negative = spent. */
  amount_cents int not null check (amount_cents <> 0),
  kind text not null check (kind in (
    'referral_referrer',   -- you invited someone and they qualified
    'referral_referred',   -- you were invited and you qualified
    'adjustment',          -- Movvy correcting something by hand
    'redemption'           -- spent against a booking (negative)
  )),
  referral_id uuid references referrals(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists account_credits_profile_idx
  on account_credits (profile_id, created_at desc);

-- One payout per side per referral. This is the real guard against
-- double-crediting — a retried trigger or a second qualifying booking hits the
-- constraint instead of quietly paying twice.
create unique index if not exists account_credits_one_per_side
  on account_credits (referral_id, kind)
  where referral_id is not null
    and kind in ('referral_referrer', 'referral_referred');

alter table account_credits enable row level security;

-- Read your own. No client INSERT at all: credits are awarded by the trigger
-- below (security definer) and by Movvy. A user who could write this table
-- could mint themselves money.
create policy account_credits_own_read on account_credits for select
  using (profile_id = auth.uid() or is_admin());

create policy account_credits_admin_all on account_credits for all
  using (is_full_admin()) with check (is_full_admin());

revoke insert, update, delete on account_credits from anon, authenticated;
grant select on account_credits to authenticated;
grant all on account_credits to service_role;

-- ── What the app shows ──────────────────────────────────────────────────────
create or replace function my_credit_balance()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'balance_cents', coalesce(sum(amount_cents), 0),
    'earned_cents',  coalesce(sum(amount_cents) filter (where amount_cents > 0), 0),
    'spent_cents',   coalesce(-sum(amount_cents) filter (where amount_cents < 0), 0),
    'entry_count',   count(*)
  )
  from account_credits
  where profile_id = auth.uid();
$$;

grant execute on function my_credit_balance() to authenticated, service_role;

-- ── Referral kind, stamped when it pays ─────────────────────────────────────
alter table referrals
  add column if not exists kind text
    check (kind in ('customer', 'driver'));

comment on column referrals.kind is
  'Which rule paid this out, set at award time from what the invitee actually did: customer = booked and paid, driver = completed a job (0110).';

-- ── The award ───────────────────────────────────────────────────────────────
-- One function, both rules, so the two paths cannot drift apart.
create or replace function award_referral_credit(
  p_referred_profile_id uuid,
  p_kind text,
  p_booking_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref record;
  v_amount int := case when p_kind = 'customer' then 7500 else 5000 end;
begin
  select * into v_ref
    from referrals
   where referred_profile_id = p_referred_profile_id
     and status = 'pending'
   limit 1;

  if not found then return; end if;

  update referrals
     set status = 'applied',
         applied_at = now(),
         kind = p_kind,
         credit_cents = v_amount
   where id = v_ref.id;

  -- Both sides, same amount. ON CONFLICT so a retry is a no-op rather than a
  -- second payout — see account_credits_one_per_side.
  insert into account_credits (profile_id, amount_cents, kind, referral_id, booking_id, note)
  values
    (v_ref.referrer_profile_id, v_amount, 'referral_referrer', v_ref.id, p_booking_id,
     case when p_kind = 'customer'
          then 'Someone you invited booked their first move'
          else 'A crew member you invited completed their first job' end),
    (v_ref.referred_profile_id, v_amount, 'referral_referred', v_ref.id, p_booking_id,
     case when p_kind = 'customer'
          then 'Welcome credit — your first move'
          else 'Welcome credit — your first completed job' end)
  on conflict do nothing;

  -- Tell them. Money arriving silently is money nobody spends.
  insert into notifications (profile_id, channel, category, title, body, data)
  select p.id, 'in_app', 'referral.credit',
         'You earned $' || (v_amount / 100) || ' in credit',
         case when p.id = v_ref.referrer_profile_id
              then 'Your referral came through. The credit is on your account.'
              else 'Your welcome credit is on your account.' end,
         jsonb_build_object('referral_id', v_ref.id, 'amount_cents', v_amount)
    from profiles p
   where p.id in (v_ref.referrer_profile_id, v_ref.referred_profile_id);
end $$;

grant execute on function award_referral_credit(uuid, text, uuid) to service_role;

-- ── Customer rule: booked AND paid ──────────────────────────────────────────
-- Fires on the deposit landing, not on the booking being inserted. 0032's
-- version paid out for drafts that were never submitted.
create or replace function referrals_apply_on_deposit_paid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.deposit_status is distinct from 'paid' then return new; end if;
  if old.deposit_status = 'paid' then return new; end if;   -- already counted
  if new.customer_id is null then return new; end if;

  -- First PAID booking only. An earlier paid booking means this customer was
  -- already converted and the referral, if any, has had its chance.
  if exists (
    select 1 from bookings b
     where b.customer_id = new.customer_id
       and b.id <> new.id
       and b.deposit_status = 'paid'
  ) then
    return new;
  end if;

  perform award_referral_credit(new.customer_id, 'customer', new.id);
  return new;
end $$;

drop trigger if exists bookings_apply_referral on bookings;          -- 0032's
drop trigger if exists bookings_referral_on_deposit on bookings;
create trigger bookings_referral_on_deposit
  after update of deposit_status on bookings
  for each row execute function referrals_apply_on_deposit_paid();

-- ── Driver rule: completed a job ────────────────────────────────────────────
create or replace function referrals_apply_on_job_completed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_performer uuid := coalesce(new.assigned_driver_profile_id, new.tracking_profile_id);
begin
  if new.status is distinct from 'completed' then return new; end if;
  if old.status = 'completed' then return new; end if;
  if v_performer is null then return new; end if;

  perform award_referral_credit(v_performer, 'driver', new.id);
  return new;
end $$;

drop trigger if exists bookings_referral_on_completed on bookings;
create trigger bookings_referral_on_completed
  after update of status on bookings
  for each row execute function referrals_apply_on_job_completed();

-- Existing pending referrals keep their default 5000 until they qualify, at
-- which point award_referral_credit stamps the right amount. Nothing is
-- back-paid: the old trigger's "applied" rows never created a credit entry, and
-- inventing balances for them would be inventing money.

notify pgrst, 'reload schema';
