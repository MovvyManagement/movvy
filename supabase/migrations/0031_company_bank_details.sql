-- =============================================================================
-- Movvy — Migration 0031: Company bank-account display metadata
--
-- Phase 3 will swap this for Stripe Connect (Movvy never holds the full
-- account number; Stripe tokenizes it). For Phase 1/2 we keep just the
-- display metadata so the company-side Bank Account screen is functional:
--
--   • institution_number  3-digit routing code (Canada)            — public
--   • transit_number      5-digit branch identifier (Canada)        — public
--   • account_last4       last 4 of the account                     — display
--   • holder_name         legal name on the account                 — display
--
-- The FULL account number is captured in the client UI for visual confirm,
-- the last 4 derived, and the rest discarded. No PAN/CVV equivalent is
-- stored. RLS keeps this row owner/dispatcher-only.
-- =============================================================================

alter table companies
  add column if not exists bank_institution_number text,
  add column if not exists bank_transit_number text,
  add column if not exists bank_account_last4 text,
  add column if not exists bank_holder_name text,
  add column if not exists bank_updated_at timestamptz;

-- Canadian routing format checks. Optional columns (NULL = not configured),
-- but when present they must conform — protects the admin UI from junk.
alter table companies
  add constraint companies_bank_institution_format check (
    bank_institution_number is null
    or bank_institution_number ~ '^[0-9]{3}$'
  );

alter table companies
  add constraint companies_bank_transit_format check (
    bank_transit_number is null
    or bank_transit_number ~ '^[0-9]{5}$'
  );

alter table companies
  add constraint companies_bank_last4_format check (
    bank_account_last4 is null
    or bank_account_last4 ~ '^[0-9]{4}$'
  );

-- No new policies needed — the existing companies_admin_update + member-read
-- policies already cover these columns.
