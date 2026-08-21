-- =============================================================================
-- Migration 0115 — record what came back off an over-collected deposit
--
-- The deposit is 20% of the ESTIMATE. The final bill is the ACTUAL time. When a
-- crew beats the estimate badly enough, the deposit can exceed the whole bill —
-- and until now nothing in the system noticed.
--
-- Real example from production: a $2,586 estimate took a $517.20 deposit; the
-- move billed at $110. The customer was $407.20 up, and:
--
--   • the receipt clamped the deposit line down to $110 so it still balanced,
--   • the final-charge path saw a $0 balance and marked the move "captured",
--   • nobody was told, and nothing gave the money back.
--
-- The refund itself is issued by bookings-update-status at completion, against
-- the deposit PaymentIntent. This column is how much of the deposit went back,
-- so the rest of the system stops treating a partly-returned deposit as if it
-- were still sitting there — specifically stripe-create-payment-intent, which
-- credits `deposit_cents` against the final bill and would otherwise credit
-- money the customer already has.
--
-- Kept separate from `deposit_status` on purpose: that column is a state
-- ('paid' / 'refunded' / 'forfeited') and cannot express "most of it came
-- back". A partial refund leaves the deposit paid and this column non-zero.
-- =============================================================================

alter table bookings
  add column if not exists deposit_refunded_cents int not null default 0;

comment on column bookings.deposit_refunded_cents is
  'Cents of the deposit returned to the customer because the actual bill came in under it. Set by bookings-update-status on completion; confirmed independently by the charge.refunded webhook.';

notify pgrst, 'reload schema';
