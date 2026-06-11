-- =============================================================================
-- Movvy — Migration 0025: Driver verification gating
--
-- Every driver must complete identity verification before they can accept
-- jobs. Movers under a company need a employment contract on file in
-- addition to gov ID.
--
-- Schema additions:
--   • document_kind enum: + 'employment_contract', + 'criminal_check'
--   • profiles.verification_status   pending / approved / rejected
--   • profiles.verified_at           timestamp
--   • can_take_jobs() RPC — returns true iff caller is approved
--
-- Gating happens in the existing bookings-accept + bookings-dispatch-assign
-- edge functions — they should call can_take_jobs() before letting an
-- unverified driver pick up a job (a follow-up to wire those checks).
-- =============================================================================

-- ─── 1. Extend the document_kind enum ──────────────────────────────────────

alter type document_kind add value if not exists 'employment_contract';
alter type document_kind add value if not exists 'criminal_check';

-- ─── 2. Verification state on profiles ──────────────────────────────────────

do $$ begin
  create type verification_status as enum ('pending', 'in_review', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

alter table profiles
  add column if not exists verification_status verification_status not null default 'pending',
  add column if not exists verified_at timestamptz,
  add column if not exists rejected_reason text;

create index if not exists profiles_verification_status_idx
  on profiles (verification_status)
  where verification_status in ('pending', 'in_review');

-- ─── 3. Helper: which docs does this user need? ────────────────────────────
--
-- Drivers (solo team OR company-affiliated): gov_id, selfie_with_id,
-- driver_license, criminal_check.
-- Movers (solo team or company-affiliated): gov_id, selfie_with_id +
-- employment_contract (only when company-affiliated).
-- Company owners + dispatchers: gov_id, selfie_with_id.

create or replace function required_documents_for_profile(p_profile_id uuid)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text;
  v_kind text;     -- 'company' | 'team' | null
  v_position text; -- 'driver' | 'mover' | 'owner' | 'dispatcher' | null
  v_required text[] := array['gov_id', 'selfie_with_id'];
begin
  -- Resolve membership: company first, then team
  select 'company', role::text into v_kind, v_position
  from company_members
  where profile_id = p_profile_id and removed_at is null
  limit 1;

  if v_kind is null then
    select 'team', role::text into v_kind, v_position
    from partner_team_members
    where profile_id = p_profile_id and removed_at is null
    limit 1;
  end if;

  if v_kind = 'company' then
    -- Company-affiliated drivers + movers must upload employment contract
    if v_position in ('driver', 'dispatcher') then
      v_required := v_required || array['driver_license', 'criminal_check', 'employment_contract'];
    end if;
  elsif v_kind = 'team' then
    if v_position = 'driver' then
      v_required := v_required || array['driver_license', 'criminal_check'];
    end if;
    -- Solo movers (2-person team) don't need employment contracts; they're owners
  end if;

  return v_required;
end $$;

grant execute on function required_documents_for_profile(uuid) to authenticated;

-- ─── 4. Gate: can_take_jobs(profile_id) ────────────────────────────────────
--
-- Returns true iff the profile is verified AND has all required documents
-- uploaded + approved. Edge functions (bookings-accept,
-- bookings-dispatch-assign, partners-invite-respond's accept branch) should
-- call this before letting the user take/be-assigned-to a job.

create or replace function can_take_jobs(p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_status verification_status;
  v_required text[];
  v_doc text;
  v_count int;
begin
  select verification_status into v_status from profiles where id = p_profile_id;
  if v_status is null then return false; end if;
  if v_status <> 'approved' then return false; end if;

  v_required := required_documents_for_profile(p_profile_id);
  foreach v_doc in array v_required loop
    select count(*) into v_count
    from verification_documents
    where profile_id = p_profile_id
      and kind::text = v_doc
      and status = 'approved';
    if v_count < 1 then return false; end if;
  end loop;

  return true;
end $$;

grant execute on function can_take_jobs(uuid) to authenticated, service_role;
