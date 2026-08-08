-- =============================================================================
-- 0094 — Keep the legacy roles in step with org_role and partner registration.
--
-- The merged model made `company_members.org_role` ('admin' | 'crew') the truth
-- the UI reads. But every SERVER gate still reads the older columns, and nothing
-- kept them in step. Two launch-blocking consequences, both found in audit:
--
-- 1. PROMOTING SOMEONE TO ADMIN GAVE THEM AN APP THAT DOES NOTHING.
--    drivers.tsx updates org_role alone. Someone who joined by code is inserted
--    with role='driver' (0073), so after promotion the UI treats them as admin
--    while the server refuses them everywhere it checks the legacy role:
--      · dispatch_queue()          → Requests tab and needs-driver bucket empty
--      · company_drivers_roster()  → roster empty, assign picker offers only "You"
--      · bookings-dispatch-decline → Release 403s
--      · driver_payouts RLS        → Earnings reads $0
--      · company_members RLS       → their own promote/remove writes match 0 rows
--    Worse, the client never checked the write, so it toasted "Now an admin" for
--    an update that changed nothing.
--
-- 2. A PARTNER COULD ACCEPT A MOVE AND THEN NEVER START IT.
--    bookings-update-status allowlists profiles.role, but the primary funnel —
--    a customer tapping "Become a Movvy partner", which calls
--    register_account_side('partner') (0086) — only stamps partner_registered_at
--    and leaves profiles.role = 'customer'. Accept and assign don't check it, so
--    the job was staffed and then stranded at `assigned`: every press of "We've
--    left HQ" 403'd. No start, no completion, no payout, and the customer got no
--    status updates on move day.
--
-- Rather than hunt down every gate, derive the legacy columns from the new one
-- and keep them derived. Membership is the source of truth: if you're on an org
-- roster, your legacy role follows your org_role.
--
-- Staff roles are never touched — movvy_admin / movvy_support outrank this.
-- =============================================================================

create or replace function sync_legacy_member_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- company_members.role: what dispatch_queue, the roster, decline and the RLS
  -- policies all still read. 'owner' for an admin, 'driver' for crew.
  new.role := case
    when new.org_role = 'admin' then 'owner'::company_member_role
    when new.org_role = 'crew'  then 'driver'::company_member_role
    else coalesce(new.role, 'driver'::company_member_role)
  end;
  return new;
end $$;

drop trigger if exists company_members_sync_legacy_role on company_members;
create trigger company_members_sync_legacy_role
  before insert or update of org_role on company_members
  for each row execute function sync_legacy_member_role();

-- profiles.role: what requireAuth's allowlist reads before letting someone move
-- a booking's status along. Runs AFTER the row lands so it sees the final state.
create or replace function sync_profile_role_from_membership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update profiles p
     set role = case when new.org_role = 'admin' then 'company_owner'::user_role
                     else 'driver'::user_role end
   where p.id = new.profile_id
     -- Only ever promote OUT of 'customer', and never overwrite staff or an
     -- already-partner role: a dispatcher must not be demoted to driver because
     -- a second membership row arrived.
     and p.role = 'customer'
     and new.removed_at is null
     and new.status = 'active';
  return null;
end $$;

drop trigger if exists company_members_sync_profile_role on company_members;
create trigger company_members_sync_profile_role
  after insert or update of org_role, status on company_members
  for each row execute function sync_profile_role_from_membership();

-- ── Backfill everyone already in the wrong state ────────────────────────────
update company_members
   set role = case when org_role = 'admin' then 'owner'::company_member_role
                   else 'driver'::company_member_role end
 where org_role is not null
   and role <> case when org_role = 'admin' then 'owner'::company_member_role
                    else 'driver'::company_member_role end;

update profiles p
   set role = case when cm.org_role = 'admin' then 'company_owner'::user_role
                   else 'driver'::user_role end
  from company_members cm
 where cm.profile_id = p.id
   and cm.removed_at is null
   and cm.status = 'active'
   and p.role = 'customer';

-- ── And for anyone who registered the partner side but has no org yet ────────
-- They can't accept work without an org, so this only matters the moment they
-- get one — but leaving profiles.role = 'customer' is what stranded moves in
-- the first place, and register_account_side is the funnel that does it.
create or replace function register_account_side(p_side text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_side not in ('customer', 'partner') then
    raise exception 'unknown side %', p_side;
  end if;

  if p_side = 'customer' then
    update profiles set customer_registered_at = coalesce(customer_registered_at, now())
     where id = v_uid;
  else
    update profiles
       set partner_registered_at = coalesce(partner_registered_at, now()),
           -- Without this the account can accept a move and never start it.
           role = case when role = 'customer' then 'driver'::user_role else role end
     where id = v_uid;
  end if;

  return my_account_sides();
end $$;

grant execute on function register_account_side(text) to authenticated;
