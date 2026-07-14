-- =============================================================================
-- Track the tip portion of each payment separately.
--
-- The customer now pays the move + tip in a single Stripe charge. Tips are
-- 100% the crew's (the move itself is split 80/20), so the admin payout math
-- must know how much of each payment was tip. The stripe-webhook writes this
-- from the PaymentIntent metadata.
-- =============================================================================

alter table payments
  add column if not exists tip_cents integer not null default 0;
