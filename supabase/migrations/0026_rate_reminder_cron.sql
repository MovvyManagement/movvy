-- =============================================================================
-- Movvy — Migration 0026: 24-hour "rate your move" reminder
--
-- The in-app ReviewPromptHost pops on completion AND surfaces a banner on
-- Home for 7 days. This adds an additional gentle nudge: a push +
-- in-app notification 24h after the move completes IF the customer
-- hasn't rated yet.
--
-- Pattern mirrors enqueue_day_before_reminders (migration 0024). Hourly
-- cron, idempotent (skips bookings that already have a reminder row).
-- =============================================================================

create or replace function enqueue_rate_reminders()
returns int language plpgsql as $$
declare
  v_count int := 0;
  v_booking record;
begin
  for v_booking in
    select b.id, b.short_code, b.customer_id, b.completed_at
    from bookings b
    where b.status = 'completed'
      and b.completed_at is not null
      -- 24-26h after completion — small window so the cron always catches it
      and b.completed_at < now() - interval '24 hours'
      and b.completed_at > now() - interval '26 hours'
      -- Skip if customer already rated this booking
      and not exists (
        select 1 from ratings r
        where r.booking_id = b.id
          and r.party = 'customer_to_partner'
      )
      -- Skip if we already enqueued this reminder
      and not exists (
        select 1 from notifications n
        where n.profile_id = b.customer_id
          and n.category = 'booking.rate_reminder'
          and (n.data->>'booking_id')::uuid = b.id
      )
  loop
    insert into notifications (profile_id, channel, category, title, body, data)
    values (
      v_booking.customer_id, 'push', 'booking.rate_reminder',
      'Rate your Movvy move',
      'Tell us how it went with your crew — takes 10 seconds.',
      jsonb_build_object('booking_id', v_booking.id, 'short_code', v_booking.short_code)
    );
    insert into notifications (profile_id, channel, category, title, body, data)
    values (
      v_booking.customer_id, 'in_app', 'booking.rate_reminder',
      'Rate your Movvy move',
      'Tell us how it went with your crew — takes 10 seconds.',
      jsonb_build_object('booking_id', v_booking.id, 'short_code', v_booking.short_code)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

grant execute on function enqueue_rate_reminders() to service_role;

-- Schedule hourly (same pattern as the day-before reminders).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('movvy-rate-reminders');
  end if;
exception when others then null;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'movvy-rate-reminders',
      '15 * * * *',                          -- :15 every hour (offset from day-before)
      $cron$ select enqueue_rate_reminders(); $cron$
    );
  end if;
end $$;
