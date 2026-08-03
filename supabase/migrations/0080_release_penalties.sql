-- =============================================================================
-- 0079 — Late-release penalty.
--
-- Releasing a move back to the open pool is free while there's still time to
-- re-staff it (3+ days out). Inside that window it strands a customer who's
-- already planned their move day, so it costs the releasing org a flat $100.
-- The release still goes through — a no-show is far worse for the customer than
-- a re-listed job — but it's recorded against the org and shown as -$100 on
-- their earnings.
--
-- Kept in its own ledger table rather than as a negative driver_payouts row:
-- payouts are a real money-out pipeline (weekly cron, Stripe) and a negative
-- entry there would corrupt those totals.
-- =============================================================================

create table if not exists release_penalties (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Who pressed Release (the org admin who owns the decision).
  profile_id uuid references profiles(id) on delete set null,
  amount_cents int not null,
  reason text,
  /** How far out the move was, for the audit trail + any dispute later. */
  hours_before_move numeric(10,2),
  created_at timestamptz not null default now()
);

create index if not exists release_penalties_company_idx on release_penalties (company_id, created_at desc);
create index if not exists release_penalties_booking_idx on release_penalties (booking_id);

alter table release_penalties enable row level security;

-- An org's admins can see their own penalties; Movvy admins see everything.
-- Writes happen server-side only (the edge function uses the service role), so
-- there is deliberately no insert/update policy for end users.
create policy release_penalties_org_read on release_penalties for select
  using (is_company_admin(company_id) or is_admin());

grant select on release_penalties to authenticated;
