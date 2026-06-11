-- =============================================================================
-- Movvy — Migration 0022: Push notifications for time-sensitive events
--
-- The existing `bookings_notify_status` trigger (migration 0009) writes
-- one in-app notification per status change. This migration extends it so
-- that THE FOLLOWING events also write a `channel='push'` row in addition
-- to the in-app row:
--
--   • assigned          ("You're matched with [crew name]")
--   • on_the_way        ("Your crew is heading to pickup")
--   • arrived           ("Your crew has arrived")
--   • completed         ("Move complete — please rate your crew")
--
-- Day-of-move, status changes happen at the worst possible time to be
-- buried in the in-app inbox. These are the ones we want to surface to
-- the lock screen.
--
-- A separate cron job (`process_push_queue`, future migration) drains
-- `channel='push'` rows where `sent_at IS NULL` by calling the
-- notifications-push edge function. For now we just produce the rows;
-- the in-app inbox already surfaces them.
-- =============================================================================

create or replace function notify_booking_status_change()
returns trigger language plpgsql as $$
declare
  v_title text;
  v_body text;
  v_category text;
  v_should_push boolean := false;
begin
  -- Only fire on actual status transitions, not initial inserts at 'draft'
  if (TG_OP = 'INSERT' and new.status in ('searching', 'draft')) then
    return new;
  end if;
  if (TG_OP = 'UPDATE' and (old.status is null or old.status = new.status)) then
    return new;
  end if;

  v_category := 'booking.' || new.status;

  case new.status
    when 'assigned' then
      v_title := 'Crew matched';
      v_body := 'Your crew is locked in for booking #' || new.short_code || '.';
      v_should_push := true;
    when 'confirmed' then
      v_title := 'Booking confirmed';
      v_body := 'Your crew confirmed your move.';
    when 'on_the_way' then
      v_title := 'Your crew is on the way';
      v_body := 'Open the app to track them live.';
      v_should_push := true;
    when 'arrived' then
      v_title := 'Your crew has arrived';
      v_body := 'They''re at the pickup. Time to open up.';
      v_should_push := true;
    when 'loading' then
      v_title := 'Loading your move';
      v_body := 'Your crew is loading up.';
    when 'in_transit' then
      v_title := 'On the way to drop-off';
      v_body := 'Live ETA in the app.';
    when 'unloading' then
      v_title := 'Unloading at drop-off';
      v_body := 'Almost done!';
    when 'completed' then
      v_title := 'Move complete';
      v_body := 'Thanks for moving with Movvy. Tap to rate your crew.';
      v_should_push := true;
    when 'cancelled' then
      v_title := 'Move cancelled';
      v_body := 'Your move was cancelled. Tap for details.';
      v_should_push := true;
    else
      v_title := 'Booking update';
      v_body := 'Status: ' || replace(new.status::text, '_', ' ');
  end case;

  -- 1) In-app notification (existing behaviour)
  insert into notifications (profile_id, channel, category, title, body, data)
  values (
    new.customer_id, 'in_app', v_category, v_title, v_body,
    jsonb_build_object('booking_id', new.id, 'short_code', new.short_code, 'status', new.status)
  );

  -- 2) Push notification (new — gated on the lock-screen-worthy events list)
  if v_should_push then
    insert into notifications (profile_id, channel, category, title, body, data)
    values (
      new.customer_id, 'push', v_category, v_title, v_body,
      jsonb_build_object('booking_id', new.id, 'short_code', new.short_code, 'status', new.status)
    );
  end if;

  return new;
end $$;
