-- =============================================================================
-- Migration 0112 — credits become spendable
--
-- Until now `account_credits` was a number a customer could look at. This makes
-- it reduce what their card is actually charged.
--
-- WHERE IT APPLIES: the FINAL charge, not the deposit. Deliberately.
--
--   • The deposit is the commitment gate — it's what turns a draft into a real
--     booking a crew can see. Letting credit cover it would mean someone with
--     $150 of referral credit could book two moves without a card being charged
--     at all, and no-show both. The gate has to cost something.
--   • The final bill is computed from ACTUAL time, so it's the number that
--     genuinely varies. Applying credit there is also where a customer expects
--     a discount to show up — on the invoice, not the deposit slip.
--
-- Leftover credit stays on the account. Nothing expires and nothing is lost if
-- the balance exceeds the bill.
--
-- DOUBLE-SPEND is prevented by the database, not by careful code: one
-- redemption row per booking, enforced by a unique index. A retried payment
-- intent, two devices tapping Pay at once, or a webhook replay all hit the
-- constraint and get the SAME already-applied amount back rather than spending
-- the balance twice.
-- =============================================================================

-- One redemption per booking. The partial index leaves earned rows alone.
create unique index if not exists account_credits_one_redemption_per_booking
  on account_credits (booking_id)
  where kind = 'redemption';

/**
 * Apply up to p_max_cents of the caller's credit to a booking.
 *
 * Returns the amount actually applied — which is 0 when there's no balance,
 * and the PREVIOUSLY applied amount when this booking has already redeemed.
 * That idempotency matters: stripe-create-payment-intent can be called several
 * times for one booking (a retry, a second device, a dismissed sheet) and every
 * call must arrive at the same number.
 */
create or replace function redeem_credit_for_booking(
  p_booking_id uuid,
  p_max_cents int
)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_existing int;
  v_balance int;
  v_apply int;
begin
  if v_uid is null then return 0; end if;
  if p_max_cents is null or p_max_cents <= 0 then return 0; end if;

  -- The booking must belong to the caller. Without this, anyone could burn
  -- their own credit against someone else's move — or probe which booking ids
  -- exist by watching the return value.
  if not exists (
    select 1 from bookings b where b.id = p_booking_id and b.customer_id = v_uid
  ) then
    return 0;
  end if;

  -- Already redeemed? Return what was applied, don't apply more.
  select -amount_cents into v_existing
    from account_credits
   where booking_id = p_booking_id and kind = 'redemption'
   limit 1;
  if found then return coalesce(v_existing, 0); end if;

  -- Lock this user's ledger rows for the rest of the transaction so a
  -- concurrent call can't read the same balance and spend it too.
  perform 1 from account_credits where profile_id = v_uid for update;

  select coalesce(sum(amount_cents), 0) into v_balance
    from account_credits where profile_id = v_uid;

  v_apply := least(greatest(v_balance, 0), p_max_cents);
  if v_apply <= 0 then return 0; end if;

  insert into account_credits (profile_id, amount_cents, kind, booking_id, note)
  values (v_uid, -v_apply, 'redemption', p_booking_id,
          'Applied to your move')
  -- Belt and braces: if a parallel transaction inserted first, take theirs.
  on conflict do nothing;

  select -amount_cents into v_existing
    from account_credits
   where booking_id = p_booking_id and kind = 'redemption'
   limit 1;

  return coalesce(v_existing, 0);
end $$;

grant execute on function redeem_credit_for_booking(uuid, int) to authenticated, service_role;

/** Release a redemption — used if a charge fails or a move is cancelled, so
 *  the credit goes back rather than evaporating with the payment. */
create or replace function release_credit_for_booking(p_booking_id uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_amount int;
begin
  delete from account_credits
   where booking_id = p_booking_id and kind = 'redemption'
   returning -amount_cents into v_amount;
  return coalesce(v_amount, 0);
end $$;

grant execute on function release_credit_for_booking(uuid) to service_role;

-- Record what was applied on the booking itself, so the receipt can show it
-- without re-deriving it from the ledger.
alter table bookings
  add column if not exists credit_applied_cents int not null default 0;

notify pgrst, 'reload schema';
