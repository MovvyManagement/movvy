-- =============================================================================
-- Migration 0099 — stop notifying customers about drafts
--
-- `bookings_notify_status` fires AFTER INSERT OR UPDATE OF status, and the live
-- function (notify_customer_on_status_change, body last set by 0037) only bails
-- when the status is unchanged:
--
--     if old.status is not null and old.status = new.status then return new;
--
-- On an INSERT `old` is NULL, so that guard never triggers and a row is written
-- for the initial status too. A booking is created as 'draft', which matches no
-- branch of either CASE, so the customer is sent the else-branch text:
--
--     "Move update" / "Open your move to see details."
--
-- for a draft they have not submitted, cannot see in their bookings list, and
-- may never finish. Production has 9 such rows (category 'booking.draft') —
-- the single largest category after searching/assigned/job.available.
--
-- Since 0063's notifications_push_fanout pushes every in_app row, each of these
-- would also have become a lock-screen push the moment the paid Apple account
-- is added: a push notification for opening the booking form.
--
-- Fix: skip the statuses that exist before the customer has committed to
-- anything. 'draft' is the booking form; 'pending' is payment authorisation in
-- flight. The first thing worth telling someone about is 'searching' ("Booking
-- confirmed"), which is what they already get.
--
-- Everything else about the function is unchanged from 0037.
--
-- NOTE for whoever reads this next: there is a SECOND, ORPHANED function named
-- notify_booking_status_change (created by 0022 to add channel='push' rows for
-- five event classes). No trigger has ever pointed at it — 0009 attached
-- bookings_notify_status to notify_customer_on_status_change and nothing has
-- re-pointed it since. Confirmed against production: 98 notification rows, zero
-- with channel='push'. It is dead code and reading it will mislead you about
-- what actually runs. Left in place rather than dropped, because dropping it is
-- schema churn with no functional gain.
-- =============================================================================

create or replace function notify_customer_on_status_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_title text;
  v_body text;
  v_category text;
begin
  if new.status is null then return new; end if;
  if old.status is not null and old.status = new.status then return new; end if;

  -- Nothing to say until the customer has actually submitted a booking.
  -- Covers the INSERT-at-'draft' case, where the old.status guard above
  -- cannot help because old is NULL.
  if new.status in ('draft', 'pending') then return new; end if;

  v_category := 'booking.' || new.status;
  v_title := case new.status
    when 'searching'  then 'Booking confirmed'
    when 'assigned'   then 'A crew has been assigned!'
    when 'confirmed'  then 'Your crew confirmed the move'
    when 'on_the_way' then 'Your crew is on the way'
    when 'arrived'    then 'Your crew has arrived at pickup'
    when 'loading'    then 'Loading has started'
    when 'in_transit' then 'On the way to drop-off'
    when 'unloading'  then 'Arrived at drop-off — unloading'
    when 'completed'  then 'Move complete!'
    when 'cancelled'  then 'Your move was cancelled'
    when 'failed'     then 'Your move could not be completed'
    else 'Move update'
  end;

  v_body := case new.status
    when 'searching'  then 'We''ve got your request — we''ll confirm your crew shortly. Nothing more for you to do.'
    when 'on_the_way' then 'You can track them on the map.'
    when 'arrived'    then 'They will start loading soon.'
    when 'in_transit' then 'Tracking will show ETA to your drop-off.'
    when 'unloading'  then 'Almost done — they are unloading your items.'
    when 'completed'  then 'Tap to rate your move.'
    else 'Open your move to see details.'
  end;

  insert into notifications (profile_id, channel, category, title, body, data)
  values (
    new.customer_id, 'in_app', v_category, v_title, v_body,
    jsonb_build_object('booking_id', new.id, 'short_code', new.short_code, 'status', new.status)
  );

  return new;
end $$;

-- Clear the 9 draft notifications already sitting in customers' inboxes. They
-- describe a state the customer was never meant to hear about, and the inbox is
-- unread-only, so they'd otherwise occupy real space in someone's list.
delete from notifications
 where category = 'booking.draft'
   and title = 'Move update';

notify pgrst, 'reload schema';
