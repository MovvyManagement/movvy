-- =============================================================================
-- Migration 0118 — pay crews from the bill, not the quote
--
-- queue_driver_payout has always written driver_payouts from the ESTIMATE:
-- driver_total_cents, service_cost_cents, movvy_margin_cents — all set at
-- booking time from the quote the deposit was taken against. It never looked at
-- actual_driver_payout_cents.
--
-- It could not have. The trigger fires on status → 'completed', and
-- bookings-update-status writes the actual_* columns in a SEPARATE update
-- afterwards. At the instant the trigger ran, the real figures did not exist.
--
-- What that produced, live:
--
--   MV-1054   estimate $2,586  ·  actual bill $110
--             driver_payouts.net_cents = $2,068.80      (80% of the ESTIMATE)
--             bookings.actual_driver_payout_cents = $88.00
--
-- Adam Crew's Earnings screen totalled $3,182.40 across two moves whose real
-- crew share is $234.40 — a 13.6× overstatement. driver_payouts feeds the crew
-- Earnings tab, the company Earnings and Invoices screens, and the exported
-- earnings statement crews would hand an accountant.
--
-- The withdrawal side was never wrong: my_payout_summary and
-- admin_crew_balances both sum bookings.actual_driver_payout_cents. So a crew
-- read $3,182.40 on one screen, requested a payout, and was offered $234.40 —
-- two numbers for the same money, and the smaller one correct.
--
-- FIX: fire on the actual figures landing, not on the status flip, and upsert
-- so a late or recomputed bill corrects the row instead of adding another.
-- =============================================================================

-- One payout per booking. Required for the upsert below, and the constraint
-- that stops a recompute from queueing a second payment for the same move.
-- Built concurrently-unsafe on purpose: this table is small and the lock is
-- momentary.
create unique index if not exists driver_payouts_one_per_booking
  on driver_payouts (booking_id);

create or replace function queue_driver_payout()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_team uuid := null;
  v_company uuid := null;
  v_driver uuid := null;
  v_net int;
  v_gross int;
  v_margin int;
begin
  if new.status <> 'completed' then return new; end if;

  -- Wait for the real bill. bookings-update-status writes actual_* in its own
  -- update after the status change, so on the status flip these are still null
  -- — that second update is what re-fires this trigger with real numbers.
  if new.actual_driver_payout_cents is null then return new; end if;

  if new.assigned_team_id is not null then
    v_team := new.assigned_team_id;
  elsif new.assigned_company_id is not null then
    v_company := new.assigned_company_id;
  elsif new.assigned_driver_profile_id is not null then
    v_driver := new.assigned_driver_profile_id;
  else
    return new;   -- nobody to pay
  end if;

  -- The crew's share of what the customer was ACTUALLY billed, plus their tip.
  -- Tips are 100% theirs (0058), so tip_driver_cents is the whole tip.
  v_net    := coalesce(new.actual_driver_payout_cents, 0)
            + coalesce(new.tip_driver_cents, 0);
  v_gross  := coalesce(new.actual_total_cents, 0)
            + coalesce(new.tip_cents, 0);
  v_margin := coalesce(new.actual_commission_cents, 0)
            + coalesce(new.tip_movvy_cut_cents, 0);

  insert into driver_payouts (
    booking_id, team_id, company_id, driver_profile_id,
    gross_cents, movvy_margin_cents, net_cents
  ) values (
    new.id, v_team, v_company, v_driver, v_gross, v_margin, v_net
  )
  on conflict (booking_id) do update set
    gross_cents        = excluded.gross_cents,
    movvy_margin_cents = excluded.movvy_margin_cents,
    net_cents          = excluded.net_cents,
    updated_at         = now()
  -- Never move a payment that has already gone out. If a bill is corrected
  -- after the crew was paid, that is a conversation, not a silent adjustment.
  where driver_payouts.status = 'pending';

  return new;
end $$;

-- Fire on the actual_* write as well as the status change. `update of` lists
-- the columns that WAKE the trigger; the body still decides what to do.
drop trigger if exists bookings_queue_payout on bookings;
create trigger bookings_queue_payout
  after update of status, actual_driver_payout_cents on bookings
  for each row execute function queue_driver_payout();

-- ── Correct the rows already written from estimates ─────────────────────────
-- Only rows still pending: anything already paid stays as it was, because the
-- money moved and rewriting history would hide that it did.
update driver_payouts dp
   set gross_cents        = coalesce(b.actual_total_cents, 0) + coalesce(b.tip_cents, 0),
       movvy_margin_cents = coalesce(b.actual_commission_cents, 0) + coalesce(b.tip_movvy_cut_cents, 0),
       net_cents          = coalesce(b.actual_driver_payout_cents, 0) + coalesce(b.tip_driver_cents, 0),
       updated_at         = now()
  from bookings b
 where b.id = dp.booking_id
   and dp.status = 'pending'
   and b.actual_driver_payout_cents is not null
   and dp.net_cents is distinct from
       (coalesce(b.actual_driver_payout_cents, 0) + coalesce(b.tip_driver_cents, 0));

notify pgrst, 'reload schema';
