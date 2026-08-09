-- =============================================================================
-- Migration 0104 — what Movvy owes each crew, on one screen
--
-- The payouts page could only show REQUESTS. If a crew had earned money and
-- simply hadn't asked for it yet, nothing in the console showed it — so the
-- only way to know your total liability was to wait for crews to ask.
--
-- This returns the same figure my_payout_summary computes for a crew admin, but
-- for every crew at once, so the console can show "owed" per crew and a total.
-- The math is deliberately identical to 0103 (earned + tips − penalties −
-- already claimed, collection required, hold NOT required) so the number a crew
-- sees in the app and the number Movvy sees in the console can never disagree.
--
-- Marking a request 'paid' already subtracts it, because `claimed` counts
-- pending + approved + paid — so recording a payment here reduces what the crew
-- sees as available in the app, with no second bookkeeping step.
--
-- MANAGEMENT ONLY. is_admin() is TRUE for the staff tier, so this uses
-- is_full_admin() — this is Movvy's whole outstanding liability plus per-crew
-- earnings, which is management information.
-- =============================================================================

create or replace function admin_crew_balances()
returns table (
  company_id uuid,
  display_name text,
  owed_cents bigint,
  in_hold_cents bigint,
  tips_cents bigint,
  claimed_cents bigint,
  lifetime_paid_cents bigint,
  open_request_id uuid,
  open_request_status text,
  open_request_cents bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with earned as (
    select b.assigned_company_id as cid,
           coalesce(sum(coalesce(b.actual_driver_payout_cents, 0)), 0) as earned_cents,
           coalesce(sum(coalesce(b.tip_driver_cents, 0)), 0) as tips_cents,
           coalesce(sum(
             case when b.completed_at > now() - interval '7 days'
                  then coalesce(b.actual_driver_payout_cents, 0) + coalesce(b.tip_driver_cents, 0)
                  else 0 end
           ), 0) as in_hold_cents
      from bookings b
     where b.assigned_company_id is not null
       and b.status = 'completed'
       and b.payment_status = 'captured'
     group by b.assigned_company_id
  ),
  pen as (
    select company_id as cid, coalesce(sum(amount_cents), 0) as penalties_cents
      from release_penalties group by company_id
  ),
  claimed as (
    select company_id as cid,
           coalesce(sum(case when status in ('pending','approved','paid') then amount_cents else 0 end), 0) as claimed_cents,
           coalesce(sum(case when status = 'paid' then amount_cents else 0 end), 0) as paid_cents
      from payout_requests group by company_id
  ),
  openreq as (
    select distinct on (company_id)
           company_id as cid, id, status::text as status, amount_cents
      from payout_requests
     where status in ('pending', 'approved')
     order by company_id, created_at desc
  )
  select c.id,
         c.display_name,
         greatest(0, coalesce(e.earned_cents, 0) + coalesce(e.tips_cents, 0)
                     - coalesce(p.penalties_cents, 0) - coalesce(cl.claimed_cents, 0))::bigint,
         coalesce(e.in_hold_cents, 0)::bigint,
         coalesce(e.tips_cents, 0)::bigint,
         coalesce(cl.claimed_cents, 0)::bigint,
         coalesce(cl.paid_cents, 0)::bigint,
         o.id,
         o.status,
         coalesce(o.amount_cents, 0)::bigint
    from companies c
    left join earned  e  on e.cid  = c.id
    left join pen     p  on p.cid  = c.id
    left join claimed cl on cl.cid = c.id
    left join openreq o  on o.cid  = c.id
   where is_full_admin()
     and (coalesce(e.earned_cents, 0) > 0 or coalesce(cl.claimed_cents, 0) > 0)
   order by 3 desc, c.display_name asc;
$$;

grant execute on function admin_crew_balances() to authenticated, service_role;

notify pgrst, 'reload schema';
