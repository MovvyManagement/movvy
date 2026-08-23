-- =============================================================================
-- Migration 0119 — a crew's payment destination is the admin's business alone
--
-- `companies_member_read` (0005:163) grants SELECT on the whole companies row
-- to any active member: `using (is_company_member(id) or is_admin())`. RLS is
-- ROW-level, so "can read the row" means "can read every column of it" —
-- including bank_holder_name, bank_institution_number, bank_transit_number,
-- bank_account_last4 and etransfer_email.
--
-- Verified against production: demo.crew1 (an hourly crew member, not an admin)
-- read back the full destination — holder name, institution, transit, account
-- tail and e-Transfer address. Writes were correctly refused; reads were not.
--
-- That contradicts the product rule that crew members don't see the crew's
-- money, and it is a worse leak than the balance they're already shielded from:
-- a balance is a number, a payment destination is what you need to redirect it.
-- The crew-member surfaces never render these fields, so nothing in the app
-- breaks — the data was simply reachable by anyone who asked the API directly.
--
-- FIX: column-level privileges. RLS cannot express "this column, not that one",
-- but GRANT can, and PostgREST enforces it — a request naming a revoked column
-- fails rather than silently returning null, so this cannot fail open.
--
-- Admins keep access through admin_crew_payout_directory() (0114) and
-- my_payout_summary(), both security-definer, and Movvy staff through the
-- service role. The console already reads banking through those paths.
-- =============================================================================

-- Postgres has no "revoke one column" — you revoke the table-wide grant and
-- re-grant the columns that stay readable. Everything below is every column of
-- `companies` EXCEPT the five payment-destination fields.
revoke select on companies from authenticated;

grant select (
  id, legal_name, display_name, registration_number, phone, email,
  primary_city_id, service_radius_km, truck_count, invite_code,
  onboarding_status, verified_at, suspended_at, suspended_reason,
  background_check_status, background_check_completed_at,
  rating_avg, rating_count,
  hq_line1, hq_line2, hq_city_name, hq_region, hq_postal,
  hq_country_code, hq_lat, hq_lng,
  stripe_account_id, payout_currency, bank_updated_at,
  created_at, updated_at, deleted_at
) on companies to authenticated;

-- bank_holder_name, bank_institution_number, bank_transit_number,
-- bank_account_last4 and etransfer_email are deliberately absent above.
--
-- bank_updated_at IS granted: "your details were changed 5 minutes ago" is
-- exactly the signal a crew member should be able to see, and it reveals
-- nothing about the destination itself.

-- UPDATE is unchanged — companies_admin_update already restricts writes to
-- org admins, and that was verified working (a crew member's PATCH affected
-- zero rows). Re-granting it here keeps the table's write surface identical to
-- before this migration.
grant update on companies to authenticated;

/**
 * The crew's own payment destination, for the org admin only.
 *
 * The app's Bank details screen needs to show an admin what is on file. With
 * the columns revoked above, a direct select can no longer do that, so this is
 * the one door — and it checks is_company_admin rather than trusting its
 * argument, which is the difference between a definer function that protects
 * something and one that launders access to it.
 */
create or replace function my_company_bank_details()
returns table (
  company_id uuid,
  bank_holder_name text,
  bank_institution_number text,
  bank_transit_number text,
  bank_account_last4 text,
  etransfer_email text,
  bank_updated_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.bank_holder_name, c.bank_institution_number,
         c.bank_transit_number, c.bank_account_last4, c.etransfer_email,
         c.bank_updated_at
    from companies c
    join company_members m
      on m.company_id = c.id
     and m.profile_id = auth.uid()
     and m.status = 'active'
     and m.removed_at is null
     and m.org_role = 'admin'
   where c.deleted_at is null;
$$;

grant execute on function my_company_bank_details() to authenticated;

comment on function my_company_bank_details() is
  'The caller''s own crew payment destination. Org admins only — crew members get no rows. The bank columns on `companies` are revoked from `authenticated` (0119), so this is the only route for the app.';

notify pgrst, 'reload schema';
