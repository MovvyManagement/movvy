-- =============================================================================
-- Push fan-out trigger (2026-07-15).
--
-- The whole push system was built around "insert a notifications row → a DB
-- trigger fires notifications-push" (see the notifications-push header + the
-- support-sos comment), but the trigger was NEVER created — so no push has
-- ever been delivered, for any event.
--
-- This creates it: every user-facing notification (channel 'push' or 'in_app')
-- fans out to the recipient's registered devices via the Expo Push API. The
-- edge function no-ops for profiles with no device tokens (admins on web), so
-- it's safe to fire on every notification. 'email' / 'sms' channels have their
-- own delivery paths and are skipped here.
--
-- Auth: sends the internal shared secret (Vault-backed via 0057's helper) in
-- the x-internal-secret header; notifications-push accepts it and skips user
-- auth. Fire-and-forget through pg_net — a push failure never blocks the insert.
-- =============================================================================

create or replace function notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel in ('push', 'in_app') then
    perform net.http_post(
      url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/notifications-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', public.internal_shared_secret(
          'db_webhook_secret', '1bb08c2a4b990e50906d807659196492bedc7396a5f15593')
      ),
      body := jsonb_build_object(
        'profile_id', new.profile_id,
        'title', new.title,
        'body', new.body,
        'data', coalesce(new.data, '{}'::jsonb),
        'category', new.category
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_push_fanout on public.notifications;
create trigger notifications_push_fanout
  after insert on public.notifications
  for each row
  execute function notify_push_on_notification();
