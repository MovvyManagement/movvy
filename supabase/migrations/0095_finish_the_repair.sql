-- =============================================================================
-- 0095 — Finish the repair. 0093 was built on a wrong model of the failure.
--
-- 0093 assumed a migration dies mid-file and keeps whatever ran before the bad
-- statement. It doesn't: the CLI wraps each file in ONE transaction, so when
-- `alter type dispute_kind add value 'sos'` raised in 0028, everything in that
-- file rolled back — including the four objects ABOVE it, which 0093 left alone.
-- Probing production confirmed it, and confirmed 0025 never ran at all:
--
--   MISSING  profiles.emergency_contact_name       (0028, above the failure)
--   MISSING  profiles.emergency_contact_phone      (0028, above the failure)
--   MISSING  dispute_kind = 'insurance_claim'      (0028, one line above 'sos')
--   MISSING  profiles.verification_status          (0025, whole file)
--   MISSING  profiles.verified_at                  (0025)
--   MISSING  profiles.rejected_reason              (0025)
--   MISSING  required_documents_for_profile()      (0025)
--   present  partner_invite_status = 'declined'    (0023 — this one did run)
--
-- What was broken by it:
--   · support-sos selects the two emergency columns, so the ENTIRE SOS endpoint
--     500s — not just the SMS step. A customer mid-move has no emergency path.
--   · "save emergency contact" in the support hub fails.
--   · Insurance claims can't be filed at all — useSupport files them with
--     kind = 'insurance_claim'.
--   · can_take_jobs (0074) reads verification_status and calls
--     required_documents_for_profile, but returns early while
--     verification_gating_enabled is false — so flipping that flag on would
--     have broken job acceptance for every partner at once, with no warning.
--
-- Definitions copied verbatim from 0025 and 0028.
-- =============================================================================

-- ── 0028: emergency contact ─────────────────────────────────────────────────
alter table profiles
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text;

do $$ begin
  alter table profiles
    add constraint profiles_emergency_phone_format
      check (
        emergency_contact_phone is null
        or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$'
      );
exception when duplicate_object then null; end $$;

-- ── 0028: the dispute kind that rolled back with it ─────────────────────────
alter type dispute_kind add value if not exists 'insurance_claim';

-- ── 0025: document kinds ────────────────────────────────────────────────────
alter type document_kind add value if not exists 'employment_contract';
alter type document_kind add value if not exists 'criminal_check';

-- ── 0025: verification state ────────────────────────────────────────────────
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

-- ── 0025: the helper can_take_jobs depends on ───────────────────────────────
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
