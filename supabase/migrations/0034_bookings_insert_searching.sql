-- =============================================================================
-- Movvy — Migration 0034: Allow customer inserts at status='searching'
--
-- The bookings-create edge function inserts new rows at status='searching'
-- because Stripe Phase 3 isn't wired yet — the planned draft → pending →
-- searching pipeline collapses to a single step until then. The RLS policy
-- bookings_customer_insert (migration 0005) only permitted 'draft', so
-- every booking attempt was being rejected at the database layer with
-- "new row violates row-level security policy".
--
-- This migration widens the policy to also allow 'searching'. When Stripe
-- lands, the edge function will revert to inserting 'draft', the deposit
-- charge will flip the row to 'pending', and payment success will flip it
-- to 'searching' — at which point 'draft' is again the only legal client-
-- side insert state and we can tighten this policy back down.
-- =============================================================================

drop policy if exists bookings_customer_insert on bookings;

create policy bookings_customer_insert on bookings for insert
  with check (
    customer_id = auth.uid()
    and status in ('draft', 'searching')
  );
