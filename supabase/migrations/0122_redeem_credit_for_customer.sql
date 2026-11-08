-- =============================================================================
-- Migration 0122 — referral credit when the final bill is paid by move code
--
-- redeem_credit_for_booking identifies the customer with auth.uid(), so it
-- returns 0 for the website's move-code page, where nobody is signed in. A
-- customer with credit would have been charged in full.
--
-- This is the same redemption with the customer named by the caller, so it is
-- service-role only: the edge function has already verified a signed tracking
-- token for this booking. Letting a browser call it would let anyone spend
-- anyone's credit.
-- =============================================================================

create or replace function redeem_credit_for_customer(
  p_customer_id uuid,
  p_booking_id uuid,
  p_max_cents int
)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing int;
  v_balance int;
  v_apply int;
begin
  if p_customer_id is null then return 0; end if;
  if p_max_cents is null or p_max_cents <= 0 then return 0; end if;

  if not exists (
    select 1 from bookings b where b.id = p_booking_id and b.customer_id = p_customer_id
  ) then
    return 0;
  end if;

  -- Already redeemed? Return what was applied, don't apply more.
  select -amount_cents into v_existing
    from account_credits
   where booking_id = p_booking_id and kind = 'redemption'
   limit 1;
  if found then return coalesce(v_existing, 0); end if;

  -- Lock the ledger so a concurrent call can't spend the same balance.
  perform 1 from account_credits where profile_id = p_customer_id for update;

  select coalesce(sum(amount_cents), 0) into v_balance
    from account_credits where profile_id = p_customer_id;

  v_apply := least(greatest(v_balance, 0), p_max_cents);
  if v_apply <= 0 then return 0; end if;

  insert into account_credits (profile_id, amount_cents, kind, booking_id, note)
  values (p_customer_id, -v_apply, 'redemption', p_booking_id, 'Applied to your move')
  on conflict do nothing;

  select -amount_cents into v_existing
    from account_credits
   where booking_id = p_booking_id and kind = 'redemption'
   limit 1;

  return coalesce(v_existing, 0);
end $$;

revoke all on function redeem_credit_for_customer(uuid, uuid, int) from public, anon, authenticated;
grant execute on function redeem_credit_for_customer(uuid, uuid, int) to service_role;
