-- =============================================================================
-- Movvy — Migration 0068: migrate partner_teams → companies (Stage 3 of merge)
--
-- Collapses the rigid 2-person partner_teams structure into the general
-- "organization" (companies) model. After this, EVERY partner is a company
-- member and the whole system runs one accept→assign job flow. The team tables
-- are retired (soft-deleted), not dropped, so the data is recoverable and any
-- lingering FK is harmless.
--
-- DESTRUCTIVE to the currently-installed app: its partner login still resolves
-- through the team tables, so team-based logins stop working until the merged
-- app ships in the rebuild. That's the accepted trade — the org membership is
-- fully intact on the companies side.
--
-- Mapping:
--   partner_teams        → companies        (id REUSED; team & company id
--                                             spaces are disjoint, so no clash)
--   partner_team_members → company_members  (org_role preserved; legacy role
--                                             admin→owner, crew→driver)
-- =============================================================================

-- The membership-level "drivers must have a licence" rule is retired: in the
-- merged model licences are verified when a performer is ASSIGNED to a move
-- (dispatch-assign → can_take_jobs), so a crew member can exist without one.
alter table company_members drop constraint if exists company_members_driver_has_license;

-- 1. Every active team becomes a company, reusing its id.
insert into companies (
  id, display_name, primary_city_id, onboarding_status, verified_at,
  suspended_at, suspended_reason, service_radius_km, rating_avg, rating_count,
  stripe_account_id, payout_currency, created_at
)
select
  pt.id, coalesce(pt.display_name, 'My Crew'), pt.primary_city_id, pt.onboarding_status,
  pt.verified_at, pt.suspended_at, pt.suspended_reason, pt.service_radius_km,
  pt.rating_avg, pt.rating_count, pt.stripe_account_id, pt.payout_currency, pt.created_at
from partner_teams pt
where pt.deleted_at is null
on conflict (id) do nothing;

-- 2. Every active team member becomes a company member. org_role carries the
--    real admin/crew tier; the legacy company_member_role is set for
--    compatibility (owner for admins, driver for crew).
insert into company_members (
  company_id, profile_id, role, org_role,
  driver_license_number, driver_license_expiry, vehicle_id,
  invited_at, accepted_at, status
)
select
  ptm.team_id, ptm.profile_id,
  case when ptm.org_role = 'admin' then 'owner'::company_member_role
       else 'driver'::company_member_role end,
  ptm.org_role,
  ptm.driver_license_number, ptm.driver_license_expiry, ptm.vehicle_id,
  ptm.invited_at, ptm.accepted_at, coalesce(ptm.status, 'active')
from partner_team_members ptm
join partner_teams pt on pt.id = ptm.team_id
where ptm.removed_at is null and pt.deleted_at is null
on conflict (company_id, profile_id) where removed_at is null do nothing;

-- 3. Re-point any bookings that were claimed by a team onto the company. Ids
--    were reused, so team_id == the new company_id.
update bookings
   set assigned_company_id = assigned_team_id,
       assigned_team_id = null
 where assigned_team_id is not null;

-- 4. Re-home verification documents from team → company (ids reused).
update verification_documents
   set company_id = team_id,
       team_id = null
 where team_id is not null;

-- 5. Retire the team rows so nothing resolves through them anymore. Kept
--    (soft-deleted) rather than dropped for recoverability.
update partner_team_members set removed_at = now(), status = 'removed' where removed_at is null;
update partner_teams        set deleted_at = now()                       where deleted_at is null;
