-- =============================================================================
-- Movvy — Migration 0042: Force PostgREST schema-cache reload
--
-- PostgREST caches the database schema and re-introspects on DDL events.
-- Occasionally the auto-reload misses a newly-added function (we hit this
-- with ensure_support_thread() from migration 0028 — it was deployed but
-- PostgREST kept returning "Could not find the function").
--
-- Re-creating the function + sending an explicit NOTIFY is the official
-- cache-bust signal. Safe to run; idempotent; takes <1 second.
-- =============================================================================

-- Re-create the function exactly as in 0028. CREATE OR REPLACE refreshes
-- PostgREST's view of it even when the body is unchanged.
create or replace function ensure_support_thread()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_thread_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select id into v_thread_id
  from chat_threads
  where customer_profile_id = v_caller
    and kind = 'support'
    and booking_id is null
  limit 1;

  if v_thread_id is not null then return v_thread_id; end if;

  insert into chat_threads (kind, booking_id, customer_profile_id, partner_profile_id, is_admin_monitored)
  values ('support', null, v_caller, null, true)
  returning id into v_thread_id;
  return v_thread_id;
end $$;

grant execute on function ensure_support_thread() to authenticated;

-- Explicit NOTIFY in case the auto-reload still misses it.
notify pgrst, 'reload schema';
