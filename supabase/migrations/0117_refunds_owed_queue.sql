-- =============================================================================
-- Migration 0117 — the refunds Movvy owes, as a queue
--
-- A deposit is 20% of the ESTIMATE and the bill is the ACTUAL time, so a crew
-- that beats the estimate badly enough leaves the customer in credit. 0115
-- refunded that automatically at completion. This replaces that with a queue an
-- admin works through, because completion is exactly when a bill is most likely
-- to be wrong — a crew taps Finish early, skips a status, or backdates a step —
-- and money that has already left is far harder to walk back than money still
-- sitting in a list.
--
-- The queue is DERIVED, not a table. There is no "refund_needed" flag to set,
-- clear, or forget: a move is owed a refund exactly while the arithmetic says
-- so, and it leaves the queue the moment deposit_refunded_cents covers it.
-- Nothing can drift out of sync with the bookings row because nothing is
-- stored twice.
-- =============================================================================

/**
 * Completed moves where the customer has paid more than the move came to.
 *
 * Management-only: the rows carry payment intent ids and customer contact
 * details, and the RLS policy on bookings admits the staff tier.
 */
create or replace function admin_refunds_owed()
returns table (
  booking_id uuid,
  short_code text,
  completed_at timestamptz,
  customer_id uuid,
  customer_name text,
  customer_email text,
  estimate_cents int,
  actual_total_cents int,
  deposit_cents int,
  credit_applied_cents int,
  deposit_refunded_cents int,
  owed_cents int,
  deposit_payment_intent_id text,
  payment_status text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id,
         b.short_code,
         b.completed_at,
         b.customer_id,
         p.full_name,
         p.email::text,
         b.price_total_cents,
         b.actual_total_cents,
         b.deposit_cents,
         coalesce(b.credit_applied_cents, 0),
         coalesce(b.deposit_refunded_cents, 0),
         (coalesce(b.deposit_cents, 0)
          + coalesce(b.credit_applied_cents, 0)
          - coalesce(b.actual_total_cents, 0)
          - coalesce(b.deposit_refunded_cents, 0))::int,
         b.stripe_deposit_payment_intent_id,
         b.payment_status
    from bookings b
    join profiles p on p.id = b.customer_id
   where is_full_admin()
     and b.status = 'completed'
     and b.deposit_status = 'paid'
     and b.actual_total_cents is not null
     -- Stripe's floor is $0.50; below that a refund costs more than it returns,
     -- so it isn't worth an admin's attention either.
     and (coalesce(b.deposit_cents, 0)
          + coalesce(b.credit_applied_cents, 0)
          - coalesce(b.actual_total_cents, 0)
          - coalesce(b.deposit_refunded_cents, 0)) >= 50
   order by b.completed_at desc nulls last;
$$;

grant execute on function admin_refunds_owed() to authenticated, service_role;

comment on function admin_refunds_owed() is
  'Completed moves whose deposit exceeded the final bill, minus anything already refunded. Derived — a move leaves this list when deposit_refunded_cents covers what is owed. Management-only (is_full_admin).';

notify pgrst, 'reload schema';
