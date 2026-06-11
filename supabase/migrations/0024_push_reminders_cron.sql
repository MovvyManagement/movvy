-- =============================================================================
-- Movvy — Migration 0024: Day-before move reminders + push delivery queue
--
-- The existing bookings_notify_status trigger (migration 0009 + 0022) writes
-- channel='push' notification rows when a booking status flips to
-- assigned/on_the_way/arrived/etc — those are EVENT-driven.
--
-- This migration adds the TIME-driven side: a row inserted into
-- notifications when a booking's scheduled_for_date is exactly tomorrow
-- ("Your move is tomorrow at 9 AM"). A pg_cron job runs hourly to find
-- bookings hitting that window and inserts the notification rows; the
-- notifications-push edge function (separately) drains channel='push'
-- rows with sent_at IS NULL.
--
-- To activate the cron in your Supabase project:
--   1. Apply this migration
--   2. Make sure pg_cron is enabled in Supabase → Database → Extensions
--   3. The schedule is registered below — no manual setup needed
-- =============================================================================

-- Idempotent helper — finds bookings starting tomorrow (in UTC) that haven't
-- been reminded yet, and inserts a "Your move is tomorrow" push for each.
create or replace function enqueue_day_before_reminders()
returns int language plpgsql as $$
declare
  v_count int := 0;
  v_booking record;
begin
  for v_booking in
    select b.id, b.short_code, b.customer_id, b.scheduled_for_date,
           b.scheduled_for_window, b.pickup_city
    from bookings b
    where b.status in ('assigned', 'confirmed')
      and b.scheduled_for_date = (current_date + interval '1 day')::date
      -- Only if we haven't already queued a day-before reminder for this booking
      and not exists (
        select 1 from notifications n
        where n.profile_id = b.customer_id
          and n.category = 'booking.reminder_day_before'
          and (n.data->>'booking_id')::uuid = b.id
      )
  loop
    insert into notifications (profile_id, channel, category, title, body, data)
    values (
      v_booking.customer_id, 'push', 'booking.reminder_day_before',
      'Your Movvy move is tomorrow',
      coalesce(
        'Tomorrow' || coalesce(' · ' || v_booking.scheduled_for_window, '')
          || ' · pickup in ' || v_booking.pickup_city,
        'See you tomorrow!'
      ),
      jsonb_build_object('booking_id', v_booking.id, 'short_code', v_booking.short_code)
    );
    -- ALSO insert the in-app copy so it shows in the notifications inbox
    insert into notifications (profile_id, channel, category, title, body, data)
    values (
      v_booking.customer_id, 'in_app', 'booking.reminder_day_before',
      'Your Movvy move is tomorrow',
      coalesce(
        'Tomorrow' || coalesce(' · ' || v_booking.scheduled_for_window, '')
          || ' · pickup in ' || v_booking.pickup_city,
        'See you tomorrow!'
      ),
      jsonb_build_object('booking_id', v_booking.id, 'short_code', v_booking.short_code)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

grant execute on function enqueue_day_before_reminders() to service_role;

-- Schedule it hourly via pg_cron. Hourly is sufficient because we check
-- "scheduled_for_date = tomorrow" — every booking hits the window once.
-- Adjust to '*/15 * * * *' for finer granularity if needed.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('movvy-day-before-reminders');
  end if;
exception when others then null;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'movvy-day-before-reminders',
      '0 * * * *',                                -- top of every hour
      $cron$ select enqueue_day_before_reminders(); $cron$
    );
  end if;
end $$;

-- ─── Push delivery: drain `notifications` rows to Expo Push ────────────────
--
-- Approach: configure a Supabase Database Webhook on `notifications` INSERT
-- where channel='push' → invokes the `notifications-push` edge function
-- with the row body. Set this up in the Supabase dashboard:
--
--   Database → Webhooks → New webhook
--     Table:        notifications
--     Events:       INSERT
--     Type:         Supabase Edge Function
--     Edge function: notifications-push
--     Filter:       channel = 'push'   (in HTTP body filter — optional)
--
-- This way every push row gets delivered to Expo Push the moment it lands
-- in the table, with no polling. The day-before cron above just inserts
-- the rows; this webhook does the actual delivery.
--
-- (We document the setup here rather than scripting it because Supabase
-- doesn't expose webhook config via SQL — it lives in their dashboard.)

