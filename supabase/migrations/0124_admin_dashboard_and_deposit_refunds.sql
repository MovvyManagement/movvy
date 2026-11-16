-- =============================================================================
-- Migration 0124 — deposits owed on cancelled moves, and the admin dashboard in
-- one query
--
-- 1. REFUNDS OWED NOW INCLUDES CANCELLED MOVES.
--    admin_refunds_owed() (0117) only listed completed moves whose bill came in
--    under the deposit. A move cancelled while its deposit was still 'paid'
--    never appeared anywhere an admin could act on it: the hourly expiry job
--    cancels requests nobody accepted without refunding, and a cancel whose
--    Stripe refund call failed leaves the deposit 'paid' on purpose so a
--    person follows up. Both now land in the same queue, so each one is a
--    single click in the console.
--
--    'paid' on a cancelled move means nobody decided to keep it. The 48-hour
--    rule marks a kept deposit 'forfeited', and a refunded one becomes
--    'refunded' through the Stripe webhook, so neither shows here.
--
--    The access check moves from is_full_admin() to movvy_admin_access(), the
--    same answer the console page and admin-refund-booking use. Before, a
--    management employee who was not the founder saw the Refunds page with an
--    empty list.
--
--    The profile join is now a LEFT join: a customer who deleted their account
--    is still owed their money, and an inner join made those rows vanish.
--
-- 2. admin_dashboard_stats() — the whole dashboard as one JSON document.
--    The page used to make 22 separate requests, three of which downloaded
--    every booking row to add them up in the browser server. PostgREST caps a
--    response at 1,000 rows, so past 1,000 bookings the all-time figures would
--    have silently stopped growing. Aggregating in the database fixes that and
--    replaces 22 round trips with one.
--
--    Days are Alberta days, computed here rather than in the web server, which
--    does not run in Alberta.
--
--    Money is returned only for management. Staff get the same document with
--    the money fields null, matching what the page already hides.
-- =============================================================================

begin;

drop function if exists admin_refunds_owed();

create function admin_refunds_owed(p_booking_id uuid default null)
returns table (
  booking_id uuid,
  short_code text,
  kind text,                    -- 'cancelled' or 'overpaid'
  happened_at timestamptz,      -- when it was cancelled, or when it finished
  cancellation_reason text,
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
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(movvy_admin_access(), '') <> 'management' then
    return;
  end if;

  return query
  with owed as (
    -- Cancelled with the deposit still held.
    select b.id, b.short_code, 'cancelled'::text as kind, b.cancelled_at as happened_at,
           b.cancellation_reason, b.customer_id, b.price_total_cents, b.actual_total_cents,
           b.deposit_cents, b.credit_applied_cents, b.deposit_refunded_cents,
           (coalesce(b.deposit_cents, 0) - coalesce(b.deposit_refunded_cents, 0))::int as owed,
           b.stripe_deposit_payment_intent_id, b.payment_status::text as payment_status
      from bookings b
     where b.status = 'cancelled'
       and b.deposit_status = 'paid'
    union all
    -- Finished, and the bill came in under the deposit (rare).
    select b.id, b.short_code, 'overpaid'::text, b.completed_at,
           null::text, b.customer_id, b.price_total_cents, b.actual_total_cents,
           b.deposit_cents, b.credit_applied_cents, b.deposit_refunded_cents,
           (coalesce(b.deposit_cents, 0)
            + coalesce(b.credit_applied_cents, 0)
            - coalesce(b.actual_total_cents, 0)
            - coalesce(b.deposit_refunded_cents, 0))::int,
           b.stripe_deposit_payment_intent_id, b.payment_status::text
      from bookings b
     where b.status = 'completed'
       and b.deposit_status = 'paid'
       and b.actual_total_cents is not null
  )
  select o.id, o.short_code, o.kind, o.happened_at, o.cancellation_reason,
         o.customer_id, p.full_name, p.email::text,
         o.price_total_cents, o.actual_total_cents, o.deposit_cents,
         coalesce(o.credit_applied_cents, 0), coalesce(o.deposit_refunded_cents, 0),
         o.owed, o.stripe_deposit_payment_intent_id, o.payment_status
    from owed o
    left join profiles p on p.id = o.customer_id
   -- Stripe's floor is $0.50; below that a refund isn't worth an admin's time.
   where o.owed >= 50
     and (p_booking_id is null or o.id = p_booking_id)
   order by o.happened_at desc nulls last;
end;
$$;

revoke all on function admin_refunds_owed(uuid) from public, anon;
grant execute on function admin_refunds_owed(uuid) to authenticated, service_role;

comment on function admin_refunds_owed(uuid) is
  'Money Movvy holds that belongs to customers: deposits on cancelled moves that were never refunded, and the rare completed move billed under its deposit. Derived; a move leaves the list once deposit_refunded_cents covers it. Management only (movvy_admin_access).';


create or replace function admin_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_access text := movvy_admin_access();
  v_mgmt boolean;
  v_today date := (now() at time zone 'America/Edmonton')::date;
  v_day_start timestamptz := (v_today::timestamp at time zone 'America/Edmonton');
  v_month_start timestamptz := (date_trunc('month', v_today)::timestamp at time zone 'America/Edmonton');
  v_30_days_ago timestamptz := now() - interval '30 days';
  v_7_days_ago timestamptz := now() - interval '7 days';
  v_money jsonb;
  v_out jsonb;
begin
  if v_access is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  v_mgmt := v_access = 'management';

  -- "Booked" means a real booking: not an abandoned checkout (draft/pending),
  -- not cancelled, not failed. Completed moves count at what they actually
  -- billed; everything else at its estimate.
  if v_mgmt then
    select jsonb_build_object(
      'gmv_today',        coalesce(sum(val) filter (where b.created_at >= v_day_start), 0),
      'commission_today', coalesce(sum(cut) filter (where b.created_at >= v_day_start), 0),
      'gmv_month',        coalesce(sum(val) filter (where b.created_at >= v_month_start), 0),
      'commission_month', coalesce(sum(cut) filter (where b.created_at >= v_month_start), 0),
      'gmv_all',          coalesce(sum(val), 0),
      'commission_all',   coalesce(sum(cut), 0),
      'avg_booking_cents', coalesce(round(avg(val)), 0),
      'trend', (
        select jsonb_agg(jsonb_build_object('day', d::date, 'cents', coalesce((
          select sum(coalesce(x.actual_total_cents, x.price_total_cents))
            from bookings x
           where x.status not in ('draft', 'pending', 'cancelled', 'failed')
             and (x.created_at at time zone 'America/Edmonton')::date = d::date
        ), 0)) order by d)
          from generate_series(v_today - 6, v_today, interval '1 day') d
      )
    )
    into v_money
    from (
      select b.created_at,
             coalesce(b.actual_total_cents, b.price_total_cents, 0) as val,
             coalesce(b.actual_commission_cents, b.movvy_margin_cents, 0) as cut
        from bookings b
       where b.status not in ('draft', 'pending', 'cancelled', 'failed')
    ) b;
  end if;

  select jsonb_build_object(
    'access', v_access,
    'today', v_today,
    'generated_at', now(),
    'money', v_money,

    'bookings_today', (select count(*) from bookings
                        where created_at >= v_day_start and status not in ('draft', 'pending')),
    'booked_all', (select count(*) from bookings
                    where status not in ('draft', 'pending', 'cancelled', 'failed')),
    'completed_all', (select count(*) from bookings where status = 'completed'),
    'cancelled_today', (select count(*) from bookings
                         where status = 'cancelled' and cancelled_at >= v_day_start),
    'cancel_rate_30d', (
      select case when count(*) = 0 then 0
                  else round(100.0 * count(*) filter (where status = 'cancelled') / count(*)) end
        from bookings
       where created_at >= v_30_days_ago and status not in ('draft', 'pending')
    ),

    'active_moves', (select count(*) from bookings
                      where status in ('assigned', 'confirmed', 'on_the_way', 'arrived',
                                       'loading', 'in_transit', 'unloading')),
    'moves_today', (select count(*) from bookings
                     where scheduled_for_date = v_today
                       and status not in ('draft', 'pending', 'cancelled', 'failed')),
    'searching', (select count(*) from bookings where status = 'searching'),

    'pending_crews', (select count(*) from partner_teams
                       where onboarding_status in ('in_review', 'docs_uploaded', 'in_progress')),
    'pending_companies', (select count(*) from companies
                           where onboarding_status in ('in_review', 'docs_uploaded', 'in_progress')),
    'verified_crews', (select count(*) from partner_teams where onboarding_status = 'verified'),
    'verified_companies', (select count(*) from companies where onboarding_status = 'verified'),
    'customers', (select count(*) from profiles where role = 'customer'),

    'open_disputes', (select count(*) from disputes where status in ('open', 'in_review')),
    'support_threads_7d', (select count(*) from chat_threads
                            where kind = 'support' and last_message_at >= v_7_days_ago),
    -- Same rule as the Support page: the newest message is not from Movvy.
    'support_waiting', (
      select count(*)
        from chat_threads t
        cross join lateral (
          select m.is_admin from chat_messages m
           where m.thread_id = t.id
           order by m.created_at desc
           limit 1
        ) last
       where t.kind = 'support' and not last.is_admin
    ),

    'rating_avg', (select round(avg(overall)::numeric, 1) from ratings),
    'rating_count', (select count(*) from ratings),

    'top_cities', (
      select coalesce(jsonb_agg(jsonb_build_object('city', city, 'moves', n) order by n desc, city), '[]'::jsonb)
        from (
          select pickup_city as city, count(*) as n
            from bookings
           where created_at >= v_30_days_ago
             and pickup_city is not null
             and status not in ('draft', 'pending')
           group by pickup_city
           order by count(*) desc, pickup_city
           limit 5
        ) c
    ),

    'payouts_pending', (select count(*) from payout_requests where status = 'pending'),
    'payouts_pending_cents', case when v_mgmt then
        (select coalesce(sum(amount_cents), 0) from payout_requests where status = 'pending')
      end,

    -- Red flag 1: cancelled moves still holding the customer's deposit.
    'deposits_owed', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'short_code', short_code)
                                order by cancelled_at desc nulls last), '[]'::jsonb)
        from bookings
       where status = 'cancelled' and deposit_status = 'paid'
         and coalesce(deposit_cents, 0) - coalesce(deposit_refunded_cents, 0) >= 50
    ),
    'deposits_owed_cents', case when v_mgmt then (
      select coalesce(sum(coalesce(deposit_cents, 0) - coalesce(deposit_refunded_cents, 0)), 0)
        from bookings
       where status = 'cancelled' and deposit_status = 'paid'
         and coalesce(deposit_cents, 0) - coalesce(deposit_refunded_cents, 0) >= 50
    ) end,
    -- Red flag 2: accepted, never started, and the date has passed.
    'stale_accepted', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'short_code', short_code)
                                order by scheduled_for_date), '[]'::jsonb)
        from bookings
       where status in ('assigned', 'confirmed') and scheduled_for_date < v_today
    ),
    'payments_live', coalesce((select enabled from feature_flags where key = 'stripe_live_enabled'), false),

    'recent', (
      select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
        from (
          select b.id, b.short_code, b.status, b.pickup_city, b.dropoff_city,
                 b.scheduled_for_date, b.created_at,
                 coalesce(b.actual_total_cents, b.price_total_cents) as value_cents,
                 case when v_mgmt then coalesce(b.actual_commission_cents, b.movvy_margin_cents) end
                   as commission_cents
            from bookings b
           where b.status <> 'draft'
           order by b.created_at desc
           limit 10
        ) r
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function admin_dashboard_stats() from public, anon;
grant execute on function admin_dashboard_stats() to authenticated;

comment on function admin_dashboard_stats() is
  'Everything the admin dashboard shows, aggregated in one call. Admins only (movvy_admin_access); money fields are null for staff.';

notify pgrst, 'reload schema';

commit;
