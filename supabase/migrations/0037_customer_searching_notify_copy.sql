-- =============================================================================
-- Movvy — Migration 0037: Customer-appropriate copy for the 'searching' state
--
-- Problem: notify_customer_on_status_change() (migration 0009) fires on INSERT
-- as well as UPDATE, so the moment a customer books — booking inserted at
-- status='searching' — they received an in-app notification titled
-- "Looking for movers". That exposes internal marketplace mechanics: the
-- customer just books; finding/matching a crew is Movvy's job, not theirs.
--
-- Fix: re-word the 'searching' transition to a reassuring booking
-- confirmation. Every other transition is unchanged. This is a straight
-- create-or-replace of the function body from 0009 with only the 'searching'
-- title (+ a body) edited.
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

-- Trigger definition is unchanged (still bookings_notify_status from 0009);
-- create-or-replace above swaps the function body in place.
