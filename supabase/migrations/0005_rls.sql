-- =============================================================================
-- Movvy — Migration 0005: Row-Level Security policies
-- Defense in depth. Even if every other layer fails, the DB rejects unauthorized rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ROLE HELPER FUNCTIONS
-- All policies use these — never re-implement role checks inline.
-- Functions are SECURITY DEFINER so they can read profiles without recursing into RLS.
-- -----------------------------------------------------------------------------

create or replace function auth_role()
returns user_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth_role() in ('movvy_admin', 'movvy_support');
$$;

create or replace function is_full_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth_role() = 'movvy_admin';
$$;

create or replace function is_company_member(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id
      and profile_id = auth.uid()
      and removed_at is null
  );
$$;

create or replace function is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id
      and profile_id = auth.uid()
      and role in ('owner', 'dispatcher')
      and removed_at is null
  );
$$;

create or replace function is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from partner_team_members
    where team_id = p_team_id
      and profile_id = auth.uid()
      and removed_at is null
  );
$$;

create or replace function is_assigned_to_booking(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking_id
      and (
        b.assigned_driver_profile_id = auth.uid()
        or (b.assigned_team_id is not null and is_team_member(b.assigned_team_id))
        or (b.assigned_company_id is not null and is_company_admin(b.assigned_company_id))
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- ENABLE RLS ON EVERY TABLE
-- -----------------------------------------------------------------------------

alter table cities enable row level security;
alter table profiles enable row level security;
alter table saved_addresses enable row level security;
alter table vehicles enable row level security;
alter table companies enable row level security;
alter table company_members enable row level security;
alter table partner_teams enable row level security;
alter table partner_team_members enable row level security;
alter table verification_documents enable row level security;
alter table bookings enable row level security;
alter table booking_status_history enable row level security;
alter table booking_tracking enable row level security;
alter table ratings enable row level security;
alter table disputes enable row level security;
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
alter table audit_logs enable row level security;
alter table rate_limit_buckets enable row level security;
alter table promo_codes enable row level security;
alter table promo_redemptions enable row level security;
alter table payouts enable row level security;
alter table notifications enable row level security;
alter table device_tokens enable row level security;

-- -----------------------------------------------------------------------------
-- CITIES — public read of active cities; only admins write.
-- -----------------------------------------------------------------------------

create policy cities_select_active on cities for select
  using (is_active or is_admin());

create policy cities_admin_write on cities for all
  using (is_full_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- PROFILES
-- Users see + edit their own row. Admins see everything. Partners can see each
-- others' minimal info via dedicated views (not here — separate view in 0006).
-- -----------------------------------------------------------------------------

create policy profiles_select_own on profiles for select
  using (id = auth.uid() or is_admin());

create policy profiles_update_own on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Don't let users escalate their own role
    and role = (select role from profiles where id = auth.uid())
  );

-- Profile inserts happen via SECURITY DEFINER trigger on auth.users creation
-- (see 0006). No direct inserts from app.
create policy profiles_admin_all on profiles for all
  using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- SAVED ADDRESSES
-- -----------------------------------------------------------------------------

create policy saved_addresses_owner on saved_addresses for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy saved_addresses_admin on saved_addresses for select
  using (is_admin());

-- -----------------------------------------------------------------------------
-- VEHICLES
-- -----------------------------------------------------------------------------

create policy vehicles_owner on vehicles for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy vehicles_company on vehicles for all
  using (company_id is not null and is_company_admin(company_id))
  with check (company_id is not null and is_company_admin(company_id));

create policy vehicles_admin on vehicles for select using (is_admin());

-- -----------------------------------------------------------------------------
-- COMPANIES
-- Members see their company. Owners/dispatchers can update it. Anyone can see
-- the public profile of a verified company (handled by a view in 0006).
-- -----------------------------------------------------------------------------

create policy companies_member_read on companies for select
  using (is_company_member(id) or is_admin());

create policy companies_admin_update on companies for update
  using (is_company_admin(id)) with check (is_company_admin(id));

create policy companies_admin_insert on companies for insert
  with check (auth.uid() is not null);  -- creator becomes owner via app

create policy companies_movvy_admin_all on companies for all
  using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- COMPANY MEMBERS
-- -----------------------------------------------------------------------------

create policy company_members_self_or_admin_select on company_members for select
  using (profile_id = auth.uid() or is_company_admin(company_id) or is_admin());

create policy company_members_admin_write on company_members for all
  using (is_company_admin(company_id) or is_admin())
  with check (is_company_admin(company_id) or is_admin());

-- -----------------------------------------------------------------------------
-- PARTNER TEAMS
-- -----------------------------------------------------------------------------

create policy partner_teams_member_read on partner_teams for select
  using (is_team_member(id) or is_admin());

create policy partner_teams_member_update on partner_teams for update
  using (is_team_member(id)) with check (is_team_member(id));

create policy partner_teams_insert on partner_teams for insert
  with check (auth.uid() is not null);

create policy partner_teams_admin on partner_teams for all
  using (is_admin()) with check (is_full_admin());

create policy ptm_self_select on partner_team_members for select
  using (profile_id = auth.uid() or is_team_member(team_id) or is_admin());

create policy ptm_team_write on partner_team_members for all
  using (is_team_member(team_id) or is_admin())
  with check (is_team_member(team_id) or is_admin());

-- -----------------------------------------------------------------------------
-- VERIFICATION DOCUMENTS
-- The subject can read their own. Admins read all. Only admins can change status.
-- -----------------------------------------------------------------------------

create policy vd_subject_select on verification_documents for select
  using (
    (profile_id = auth.uid())
    or (team_id is not null and is_team_member(team_id))
    or (company_id is not null and is_company_admin(company_id))
    or is_admin()
  );

create policy vd_subject_insert on verification_documents for insert
  with check (
    (profile_id = auth.uid())
    or (team_id is not null and is_team_member(team_id))
    or (company_id is not null and is_company_admin(company_id))
  );

create policy vd_admin_update on verification_documents for update
  using (is_admin()) with check (is_admin());

create policy vd_admin_delete on verification_documents for delete
  using (is_full_admin());

-- -----------------------------------------------------------------------------
-- BOOKINGS
-- Customer sees their own. Assigned partner/driver sees theirs. Admins all.
-- Customer can INSERT only as themselves; status state machine enforced server-side.
-- -----------------------------------------------------------------------------

create policy bookings_customer_select on bookings for select
  using (customer_id = auth.uid());

create policy bookings_partner_select on bookings for select
  using (is_assigned_to_booking(id));

create policy bookings_admin_select on bookings for select
  using (is_admin());

create policy bookings_customer_insert on bookings for insert
  with check (customer_id = auth.uid() and status = 'draft');

-- Customer can only update non-financial fields and only on draft bookings
create policy bookings_customer_update_draft on bookings for update
  using (customer_id = auth.uid() and status = 'draft')
  with check (customer_id = auth.uid());

-- Assigned crew updates status only (other fields protected by trigger in 0006)
create policy bookings_partner_update on bookings for update
  using (is_assigned_to_booking(id))
  with check (is_assigned_to_booking(id));

create policy bookings_admin_all on bookings for all
  using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- BOOKING STATUS HISTORY — read only for participants, written by trigger
-- -----------------------------------------------------------------------------

create policy bsh_read on booking_status_history for select
  using (
    exists (
      select 1 from bookings b where b.id = booking_id
      and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id) or is_admin())
    )
  );

-- -----------------------------------------------------------------------------
-- BOOKING TRACKING
-- Customer of the booking + assigned crew + admins can read.
-- Only the assigned driver can insert pings (one row at a time).
-- -----------------------------------------------------------------------------

create policy bt_select on booking_tracking for select
  using (
    exists (
      select 1 from bookings b where b.id = booking_id
      and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id) or is_admin())
    )
  );

create policy bt_insert_driver on booking_tracking for insert
  with check (
    driver_profile_id = auth.uid()
    and exists (select 1 from bookings b where b.id = booking_id and b.assigned_driver_profile_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- RATINGS
-- Visible to both parties + admins. A user can only insert ratings FROM themselves
-- after the booking is completed.
-- -----------------------------------------------------------------------------

create policy ratings_select on ratings for select
  using (
    from_profile_id = auth.uid()
    or to_profile_id = auth.uid()
    or (to_team_id is not null and is_team_member(to_team_id))
    or (to_company_id is not null and is_company_admin(to_company_id))
    or is_admin()
  );

create policy ratings_insert_own on ratings for insert
  with check (
    from_profile_id = auth.uid()
    and exists (
      select 1 from bookings b where b.id = booking_id and b.status = 'completed'
      and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id))
    )
  );

-- Ratings are immutable once submitted (no UPDATE policy = no updates allowed)
create policy ratings_admin_all on ratings for all
  using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- DISPUTES
-- -----------------------------------------------------------------------------

create policy disputes_participant_select on disputes for select
  using (
    opened_by = auth.uid()
    or against_profile_id = auth.uid()
    or (against_company_id is not null and is_company_admin(against_company_id))
    or exists (
      select 1 from bookings b where b.id = booking_id
      and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id))
    )
    or is_admin()
  );

create policy disputes_open on disputes for insert
  with check (
    opened_by = auth.uid()
    and exists (
      select 1 from bookings b where b.id = booking_id
      and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id))
    )
  );

create policy disputes_admin_update on disputes for update
  using (is_admin()) with check (is_admin());

-- -----------------------------------------------------------------------------
-- CHAT
-- -----------------------------------------------------------------------------

create policy chat_threads_participant on chat_threads for select
  using (
    customer_profile_id = auth.uid()
    or partner_profile_id = auth.uid()
    or (booking_id is not null and is_assigned_to_booking(booking_id))
    or is_admin()
  );

create policy chat_threads_admin_all on chat_threads for all
  using (is_admin()) with check (is_admin());

create policy chat_messages_participant on chat_messages for select
  using (
    exists (
      select 1 from chat_threads t where t.id = thread_id
      and (
        t.customer_profile_id = auth.uid()
        or t.partner_profile_id = auth.uid()
        or (t.booking_id is not null and is_assigned_to_booking(t.booking_id))
        or is_admin()
      )
    )
  );

create policy chat_messages_send on chat_messages for insert
  with check (
    sender_profile_id = auth.uid()
    and exists (
      select 1 from chat_threads t where t.id = thread_id
      and (
        t.customer_profile_id = auth.uid()
        or t.partner_profile_id = auth.uid()
        or (t.booking_id is not null and is_assigned_to_booking(t.booking_id))
      )
    )
  );

-- -----------------------------------------------------------------------------
-- AUDIT LOGS — readable by admins only; written by edge functions via service role
-- -----------------------------------------------------------------------------

create policy audit_logs_admin_read on audit_logs for select using (is_admin());
-- No INSERT/UPDATE/DELETE policies = only service role can write

-- -----------------------------------------------------------------------------
-- RATE LIMIT BUCKETS — only service role; no end-user access
-- -----------------------------------------------------------------------------

create policy rl_no_user_access on rate_limit_buckets for all using (false);

-- -----------------------------------------------------------------------------
-- PROMO CODES
-- -----------------------------------------------------------------------------

create policy promo_codes_read_active on promo_codes for select
  using (is_active and (expires_at is null or expires_at > now()));

create policy promo_codes_admin_write on promo_codes for all
  using (is_admin()) with check (is_full_admin());

create policy promo_red_select_own on promo_redemptions for select
  using (profile_id = auth.uid() or is_admin());

-- -----------------------------------------------------------------------------
-- PAYOUTS — partner sees their own; admins see all
-- -----------------------------------------------------------------------------

create policy payouts_team_select on payouts for select
  using (team_id is not null and is_team_member(team_id));

create policy payouts_company_select on payouts for select
  using (company_id is not null and is_company_admin(company_id));

create policy payouts_admin_all on payouts for all
  using (is_admin()) with check (is_full_admin());

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS & DEVICE TOKENS
-- -----------------------------------------------------------------------------

create policy notifications_own_select on notifications for select
  using (profile_id = auth.uid() or is_admin());

create policy notifications_own_update on notifications for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy device_tokens_own on device_tokens for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
