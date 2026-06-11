-- =============================================================================
-- Movvy — Migration 0032: Apply referrals when the invitee books their first move
--
-- The Invite Friends screen promises "$50 credit when your friend books a
-- move". Until now there was no DB-side mechanism to fulfil that promise —
-- referrals rows stayed at status='pending' forever and the referrer never
-- earned anything.
--
-- This trigger flips every pending referral pointing at a customer to
-- 'applied' the first time that customer inserts a booking. Idempotent by
-- design: subsequent bookings short-circuit because the trigger checks for
-- a prior booking by the same customer before touching the referrals table.
--
-- Why "first booking" and not "first completed move"? Per product instruction:
-- the referrer is rewarded the moment the invitee commits to a booking
-- (deposit captured) rather than waiting on the move to complete. Aligns
-- the incentive with the actual conversion event.
-- =============================================================================

create or replace function referrals_apply_on_first_booking()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  -- Only fire on the customer's FIRST booking. Cheap exists check on the
  -- bookings table — covered by the customer_id index.
  if exists (
    select 1
    from bookings
    where customer_id = new.customer_id
      and id <> new.id
  ) then
    return new;
  end if;

  update referrals
    set status = 'applied',
        applied_at = now()
    where referred_profile_id = new.customer_id
      and status = 'pending';

  return new;
end $$;

drop trigger if exists bookings_apply_referral on bookings;
create trigger bookings_apply_referral
  after insert on bookings
  for each row execute function referrals_apply_on_first_booking();
