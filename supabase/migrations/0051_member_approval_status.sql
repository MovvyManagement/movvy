-- =============================================================================
-- Member approval status — Option C join flow
--
-- Adds a `status` column + approval-trail columns to partner_team_members
-- and company_members. Anyone with a valid team/company invite code can now
-- sign up and join, but they land in `pending_approval` until the team's
-- driver-operator (or company owner/dispatcher) explicitly approves them.
--
-- Status values:
--   • pending_approval  → self-joined via code, waiting for owner action
--   • active            → allowed to work jobs, appear in rosters
--   • rejected          → owner refused; membership row kept for audit
--   • removed           → previously active, since removed (old removed_at
--                          semantics preserved via sync trigger)
--
-- Backfill: every existing non-removed row → 'active', removed rows →
-- 'removed'. That preserves current behavior for every legacy roster.
-- =============================================================================

-- ─── Add columns ─────────────────────────────────────────────────────────────
alter table partner_team_members
  add column if not exists status text not null default 'active',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_profile_id uuid references profiles(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by_profile_id uuid references profiles(id),
  add column if not exists rejected_reason text;

alter table company_members
  add column if not exists status text not null default 'active',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_profile_id uuid references profiles(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by_profile_id uuid references profiles(id),
  add column if not exists rejected_reason text;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Every existing row was created via the old invite flow. If removed_at is
-- set, mark removed; otherwise mark active. This keeps every legacy roster
-- rendering the same after migration.
update partner_team_members
  set status = case when removed_at is not null then 'removed' else 'active' end
  where status = 'active' or status is null;

update company_members
  set status = case when removed_at is not null then 'removed' else 'active' end
  where status = 'active' or status is null;

-- ─── Constrain valid values ─────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'ptm_status_valid'
  ) then
    alter table partner_team_members
      add constraint ptm_status_valid
        check (status in ('pending_approval', 'active', 'rejected', 'removed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'cm_status_valid'
  ) then
    alter table company_members
      add constraint cm_status_valid
        check (status in ('pending_approval', 'active', 'rejected', 'removed'));
  end if;
end $$;

-- ─── Sync trigger: removed_at → status='removed' ─────────────────────────────
-- Keeps the old code paths that only set removed_at (without updating status)
-- consistent — status auto-flips to 'removed'.
create or replace function sync_member_status_on_removal()
returns trigger
language plpgsql
as $$
begin
  if new.removed_at is not null and (old.removed_at is null) then
    new.status = 'removed';
  end if;
  return new;
end $$;

drop trigger if exists partner_team_members_status_sync on partner_team_members;
create trigger partner_team_members_status_sync
  before update on partner_team_members
  for each row execute function sync_member_status_on_removal();

drop trigger if exists company_members_status_sync on company_members;
create trigger company_members_status_sync
  before update on company_members
  for each row execute function sync_member_status_on_removal();

-- ─── Indexes for the new pending-approval queries ────────────────────────────
create index if not exists partner_team_members_pending_idx
  on partner_team_members (team_id, status)
  where status = 'pending_approval';

create index if not exists company_members_pending_idx
  on company_members (company_id, status)
  where status = 'pending_approval';

-- ─── RLS: pending members can read their own row (to poll their status) ──────
-- Existing RLS already allows self-reads via profile_id = auth.uid(); confirm.
-- Owners already see all rows in their team/company via existing membership
-- policies. No new RLS needed.

-- ─── Constraint: at most ONE pending_approval per (team, profile) ────────────
-- Prevents a user from spamming duplicate join requests. Existing UNIQUE
-- constraints already cover the "already an active member" case.
create unique index if not exists partner_team_members_one_pending
  on partner_team_members (team_id, profile_id)
  where status = 'pending_approval';

create unique index if not exists company_members_one_pending
  on company_members (company_id, profile_id)
  where status = 'pending_approval';
