-- =============================================================================
-- Move DB→edge-function shared secrets out of migration source into Vault.
--
-- Migration 0048 hardcoded two secrets in plaintext SQL (now permanently in
-- git history, so both must be treated as EXPOSED and rotated):
--   • the x-webhook-secret used by the welcome-email triggers
--   • the x-cron-secret used by the weekly-payout cron job
--
-- This migration redefines the trigger functions + cron job to read their
-- secret from Supabase Vault at call time, falling back to the legacy
-- (exposed) values ONLY while the Vault entries don't exist yet — so nothing
-- breaks the moment this deploys, and rotation becomes a data change with no
-- redeploy.
--
-- ── ROTATION RUNBOOK (run once in the SQL editor, then you're done) ─────────
--   1. Generate two new random values (e.g. `openssl rand -hex 24` twice).
--   2. select vault.create_secret('<NEW_WEBHOOK_VALUE>', 'db_webhook_secret');
--      select vault.create_secret('<NEW_CRON_VALUE>',    'cron_secret');
--   3. supabase secrets set DB_WEBHOOK_SECRET=<NEW_WEBHOOK_VALUE> \
--                           CRON_SECRET=<NEW_CRON_VALUE>
--   (The edge functions compare the header against these env vars, so both
--   sides flip together. No function redeploy needed.)
-- =============================================================================

-- Vault ships enabled on hosted Supabase; this is a no-op there and makes
-- local `supabase db reset` work too.
create extension if not exists supabase_vault cascade;

-- Helper: resolve a shared secret from Vault, with an explicit fallback for
-- the pre-rotation window. SECURITY DEFINER so the calling context (trigger
-- under any role, cron under postgres) can read Vault consistently.
create or replace function internal_shared_secret(p_name text, p_fallback text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = p_name
    limit 1;
  exception when others then
    v_secret := null;  -- vault unreadable → use fallback so email flow survives
  end;
  return coalesce(v_secret, p_fallback);
end;
$$;

revoke all on function internal_shared_secret(text, text) from public, anon, authenticated;

-- ─── Customer welcome trigger (was 0048) — now Vault-backed ──────────────────
create or replace function notify_customer_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'customer' and new.email is not null then
    perform net.http_post(
      url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/customer-welcome-on-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', public.internal_shared_secret(
          'db_webhook_secret', '1bb08c2a4b990e50906d807659196492bedc7396a5f15593')
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'profiles',
        'record', row_to_json(new)
      )
    );
  end if;
  return new;
end;
$$;

-- ─── Partner welcome trigger (was 0048) — now Vault-backed ───────────────────
create or replace function notify_partner_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/partner-welcome-on-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', public.internal_shared_secret(
        'db_webhook_secret', '1bb08c2a4b990e50906d807659196492bedc7396a5f15593')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'partner_teams',
      'record', row_to_json(new)
    )
  );
  return new;
end;
$$;

-- ─── Weekly payout cron (was 0048) — now Vault-backed ────────────────────────
-- The job body is evaluated at each run, so the Vault lookup happens live and
-- rotation takes effect on the next scheduled firing.
select cron.unschedule('weekly-payout-summary')
where exists (select 1 from cron.job where jobname = 'weekly-payout-summary');

select cron.schedule(
  'weekly-payout-summary',
  '0 16 * * 5',
  $$
    select net.http_post(
      url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/cron-weekly-payouts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.internal_shared_secret(
          'cron_secret', 'b02ef5b9d0b876ab78c352a06062042c0ce34a87af743085')
      ),
      body := '{}'::jsonb
    );
  $$
);
