-- =============================================================================
-- Movvy — Migration 0041: Partner team bank + tax metadata
--
-- Mirrors migration 0031 (which added bank columns to `companies`) for the
-- 2-person partner_teams. Independent operators need the same Profile-screen
-- editors a company has — Bank Account + Tax info — so payouts can be
-- triggered without an out-of-band email.
--
-- Phase 3 swaps the bank columns for Stripe Connect (Movvy never holds the
-- full account number; Stripe tokenizes it). Until then we capture display
-- metadata only — institution / transit / last-4 — and a `gst_number` for
-- the GST/HST registration that prints on the team's invoices.
--
-- RLS already lets every team member read partner_teams, and team members
-- can update it via partner_teams_member_update — no new policies needed.
-- =============================================================================

alter table partner_teams
  add column if not exists bank_holder_name text,
  add column if not exists bank_institution_number text,
  add column if not exists bank_transit_number text,
  add column if not exists bank_account_last4 text,
  add column if not exists bank_updated_at timestamptz,
  add column if not exists gst_number text;

-- Canadian routing format checks. Optional columns (NULL = not configured),
-- but when present they must conform — protects the admin UI from junk.
alter table partner_teams
  add constraint partner_teams_bank_institution_format check (
    bank_institution_number is null
    or bank_institution_number ~ '^[0-9]{3}$'
  );

alter table partner_teams
  add constraint partner_teams_bank_transit_format check (
    bank_transit_number is null
    or bank_transit_number ~ '^[0-9]{5}$'
  );

alter table partner_teams
  add constraint partner_teams_bank_last4_format check (
    bank_account_last4 is null
    or bank_account_last4 ~ '^[0-9]{4}$'
  );

-- GST / HST is the federal Canadian tax registration. Format is
-- 9 digits + 'RT' + 4 digits (e.g. "123456789RT0001"). Stored uppercase.
alter table partner_teams
  add constraint partner_teams_gst_format check (
    gst_number is null
    or gst_number ~ '^[0-9]{9}(RT|RP|RC)[0-9]{4}$'
  );
