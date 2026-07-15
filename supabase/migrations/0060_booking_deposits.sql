-- =============================================================================
-- 20% booking deposit (business-model change, Adam 2026-07-07).
--
-- New money flow:
--   • At booking, the customer pays a DEPOSIT = 20% of the estimate
--     (price_total_cents) via Stripe.
--   • At completion, the final charge = actual_total_cents − deposit (+ tip).
--   • Cancellation: deposit refunded ONLY if cancelled more than 48 hours
--     before the scheduled start; at ≤48h it is forfeited (compensates the
--     crew that held the slot). This REPLACES the old tiered 100/80/50/0
--     bookkeeping refund.
--
-- deposit_status lifecycle: unpaid → paid → (applied implicitly at final
-- charge) | refunded (cancel >48h) | forfeited (cancel ≤48h).
-- =============================================================================

alter table bookings
  add column if not exists deposit_cents integer,
  add column if not exists deposit_status text not null default 'unpaid'
    check (deposit_status in ('unpaid', 'paid', 'refunded', 'forfeited')),
  add column if not exists stripe_deposit_payment_intent_id text,
  add column if not exists deposit_paid_at timestamptz;

-- Distinguish deposit rows from final-payment rows in the admin ledger.
alter table payments
  add column if not exists kind text not null default 'final'
    check (kind in ('deposit', 'final'));
