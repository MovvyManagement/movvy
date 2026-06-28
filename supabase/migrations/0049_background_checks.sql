-- =============================================================================
-- background_checks — full audit trail for every criminal record check, driver's
-- abstract, and provider verification we run on a partner before they're allowed
-- on the platform.
--
-- Design:
--   • One row per check (with provider, consent file, result file, dates).
--   • partner_teams + companies get a denormalized `background_check_status`
--     column kept in sync via trigger — so the admin approvals UI doesn't have
--     to join every render.
--   • `provider` is open string ('manual', 'certn', 'sterling', etc.) so the
--     same table absorbs the future Certn integration without a migration.
--   • RLS: subject can read their OWN checks (just status, not the PDF URL);
--     admins can read everything; service role inserts.
-- =============================================================================

-- ─── Subject types ───────────────────────────────────────────────────────────
create type background_check_subject_type as enum ('team', 'company', 'driver');

-- ─── Check statuses ──────────────────────────────────────────────────────────
-- consent_pending → waiting on signed consent from the partner
-- in_progress     → consent received, check submitted to provider
-- passed          → clean result
-- flagged         → result contains a hit that needs human review
-- failed          → check returned a disqualifying result
-- expired         → check passed but is now > 12 months old
create type background_check_status as enum (
  'consent_pending', 'in_progress', 'passed', 'flagged', 'failed', 'expired'
);

-- ─── Audit table ─────────────────────────────────────────────────────────────
create table if not exists background_checks (
  id uuid primary key default gen_random_uuid(),
  subject_type background_check_subject_type not null,
  subject_id uuid not null,             -- partner_teams.id, companies.id, or profiles.id
  provider text not null default 'manual',  -- 'manual' | 'certn' | 'sterling' | ...
  provider_ref text,                    -- external reference id from the provider
  status background_check_status not null default 'consent_pending',

  -- Consent — PIPEDA requires explicit written consent before pulling any check
  consent_signed_at timestamptz,
  consent_document_url text,            -- Storage URL of the signed consent PDF
  consent_ip text,                      -- IP at signing time (where consent in-app)

  -- Lifecycle
  requested_at timestamptz,             -- When we submitted to the provider
  completed_at timestamptz,             -- When the result came back
  expires_at timestamptz,               -- Result expires 12 months after completed_at
                                        -- (configurable per province; AB = 12mo standard)

  -- Result
  result_document_url text,             -- Storage URL of the result PDF
  result_summary text,                  -- Brief admin-written summary
  hit_count integer,                    -- 0 for a clean check, >0 for a flagged one

  -- Audit
  requested_by_admin_id uuid references profiles(id),
  reviewed_by_admin_id uuid references profiles(id),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists background_checks_subject_idx
  on background_checks (subject_type, subject_id, created_at desc);
create index if not exists background_checks_status_idx
  on background_checks (status) where status in ('consent_pending', 'in_progress', 'flagged');
create index if not exists background_checks_expires_at_idx
  on background_checks (expires_at) where status = 'passed';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table background_checks enable row level security;

-- Admins can read all checks (including result_document_url)
drop policy if exists "bg_checks admin read" on background_checks;
create policy "bg_checks admin read"
  on background_checks for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('movvy_admin', 'movvy_support')
    )
  );

-- Subjects can read their OWN check status — but not the result_document_url
-- (avoid leaking a PII-rich PDF to the partner). UI uses a view that drops it.
drop policy if exists "bg_checks subject read own" on background_checks;
create policy "bg_checks subject read own"
  on background_checks for select
  using (
    -- driver: their own profile
    (subject_type = 'driver' and subject_id = auth.uid())
    or
    -- team: any member of the team
    (subject_type = 'team' and exists (
      select 1 from partner_team_members
      where partner_team_members.team_id = background_checks.subject_id
        and partner_team_members.profile_id = auth.uid()
        and partner_team_members.removed_at is null
    ))
    or
    -- company: owner/dispatcher
    (subject_type = 'company' and exists (
      select 1 from company_members
      where company_members.company_id = background_checks.subject_id
        and company_members.profile_id = auth.uid()
        and company_members.removed_at is null
        and company_members.role in ('owner', 'dispatcher')
    ))
  );

-- Inserts/updates come from the admin-set-background-check edge function via
-- service-role client — no end-user write policy needed.

-- ─── Subject-side denormalized state ─────────────────────────────────────────
-- Keeps a "current" status next to the partner row so the admin approvals
-- UI doesn't have to subquery every render.

alter table partner_teams
  add column if not exists background_check_status background_check_status,
  add column if not exists background_check_completed_at timestamptz;

alter table companies
  add column if not exists background_check_status background_check_status,
  add column if not exists background_check_completed_at timestamptz;

-- ─── Sync trigger ────────────────────────────────────────────────────────────
-- When a background_checks row is inserted or updated, copy the current
-- status + completed_at back to the subject row. Latest check wins.

create or replace function sync_subject_background_check()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.subject_type = 'team' then
    update partner_teams
       set background_check_status = new.status,
           background_check_completed_at = new.completed_at
     where id = new.subject_id;
  elsif new.subject_type = 'company' then
    update companies
       set background_check_status = new.status,
           background_check_completed_at = new.completed_at
     where id = new.subject_id;
  end if;
  -- driver (per-profile) checks aren't reflected on a subject row — they're
  -- queried inline by the admin UI when reviewing individual drivers.
  return new;
end;
$$;

drop trigger if exists sync_subject_bg_check on background_checks;
create trigger sync_subject_bg_check
  after insert or update on background_checks
  for each row
  execute function sync_subject_background_check();

-- ─── Updated-at trigger ──────────────────────────────────────────────────────
create or replace function touch_background_checks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_bg_checks on background_checks;
create trigger touch_bg_checks
  before update on background_checks
  for each row
  execute function touch_background_checks_updated_at();

-- ─── Expiry cron (every Sunday) ──────────────────────────────────────────────
-- Marks any 'passed' check older than its expires_at as 'expired'. Movvy then
-- prompts the partner to renew on their next login.
--
-- Lives here (not in a separate file) so all background-check plumbing is
-- in one migration the future Adam can git-blame to.

select cron.unschedule('background-check-expiry')
where exists (select 1 from cron.job where jobname = 'background-check-expiry');

select cron.schedule(
  'background-check-expiry',
  '0 5 * * 0',  -- Sundays 5 AM UTC
  $$
    update background_checks
       set status = 'expired'
     where status = 'passed'
       and expires_at < now();
  $$
);
