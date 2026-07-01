-- =============================================================================
-- Per-account brute-force protection for the admin console login
--
-- Supabase Auth's built-in rate limits are IP-based and share a bucket across
-- all users. That doesn't stop a credential-stuffing attacker who rotates
-- IPs (residential proxies) but hammers a single known admin email.
--
-- This adds:
--   • auth_login_attempts table — one row per failed attempt, indexed by
--     lower(email) + created_at for fast recent-attempt counts
--   • rl_check_admin_login RPC — returns true when the account is currently
--     locked out (5 failures in 15 min, lockout for 30 min)
--   • Cleanup cron: purge attempts older than 24h nightly
--
-- The web/app/admin-management/login/actions.ts server action calls the RPC
-- BEFORE calling signInWithPassword, and inserts a row AFTER a failure.
-- =============================================================================

create table if not exists auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email_lower text not null,        -- lower-cased email attempted
  ip text,                          -- best-effort client IP
  user_agent text,                  -- for later analysis
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fast recent-attempt counts
create index if not exists auth_login_attempts_email_created_idx
  on auth_login_attempts (email_lower, created_at desc);

-- Purge old attempts (keep last 24h for forensics)
create index if not exists auth_login_attempts_created_idx
  on auth_login_attempts (created_at)
  where succeeded = false;

-- RLS — admins only see this table
alter table auth_login_attempts enable row level security;

drop policy if exists "auth_attempts admin read" on auth_login_attempts;
create policy "auth_attempts admin read"
  on auth_login_attempts for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('movvy_admin', 'movvy_support')
    )
  );

-- Inserts come from the server action via service-role — no user insert policy

-- ─── Lockout check RPC ──────────────────────────────────────────────────────
-- Returns:
--   {"locked": true, "seconds_remaining": 1200}       ← currently locked
--   {"locked": false, "recent_failures": 2}           ← ok, but N recent fails
create or replace function rl_check_admin_login(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent int;
  v_last_fail timestamptz;
  v_lockout_window interval := interval '15 minutes';
  v_lockout_duration interval := interval '30 minutes';
  v_threshold int := 5;
begin
  select count(*), max(created_at)
    into v_recent, v_last_fail
    from auth_login_attempts
   where email_lower = lower(p_email)
     and succeeded = false
     and created_at > now() - v_lockout_window;

  if v_recent >= v_threshold then
    return jsonb_build_object(
      'locked', true,
      'seconds_remaining',
        greatest(
          extract(epoch from (v_last_fail + v_lockout_duration - now()))::int,
          0
        )
    );
  end if;

  return jsonb_build_object(
    'locked', false,
    'recent_failures', v_recent
  );
end;
$$;

grant execute on function rl_check_admin_login(text) to authenticated, anon;

-- ─── Log-a-failure helper ────────────────────────────────────────────────────
create or replace function rl_log_admin_login_failure(
  p_email text,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into auth_login_attempts (email_lower, ip, user_agent, succeeded)
    values (lower(p_email), p_ip, p_user_agent, false);
end;
$$;

grant execute on function rl_log_admin_login_failure(text, text, text)
  to authenticated, anon;

-- ─── Nightly purge (2 AM UTC) ────────────────────────────────────────────────
select cron.unschedule('auth-attempts-purge')
where exists (select 1 from cron.job where jobname = 'auth-attempts-purge');

select cron.schedule(
  'auth-attempts-purge',
  '0 2 * * *',
  $$
    delete from auth_login_attempts
      where created_at < now() - interval '24 hours';
  $$
);
