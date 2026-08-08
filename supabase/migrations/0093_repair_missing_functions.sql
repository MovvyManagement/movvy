-- =============================================================================
-- 0093 — Repair: five functions the app calls that never existed in production.
--
-- Migrations 0021, 0028 and 0030 are all recorded as applied on the remote, yet
-- the functions they declare are absent from the live schema. Proof that 0028 in
-- particular never ran to completion: `alter type dispute_kind add value 'sos'`
-- sits at line 30 of that file, and production still rejects 'sos' as an invalid
-- enum value. Everything below that line silently never came into being, and the
-- migration history says otherwise — so `db push` had nothing left to do and no
-- one noticed for months.
--
-- What was broken as a result:
--   · customer_booking_audit_log + booking_audit_hash  → the customer's move
--     audit trail screen (app/(customer)/support/audit/[id].tsx) threw on open
--   · public_reviews_for_team + public_reviews_for_company → the partner
--     profile's review feed rendered empty forever
--   · ensure_my_profile → the "profile row is missing" recovery path in
--     useProfile silently did nothing, leaving a null profile permanently
--   · dispute_kind lacked 'sos' → an SOS dispute insert fails outright
--
-- Definitions below are copied VERBATIM from the original migrations so this is
-- a repair, not a redesign. Everything is create-or-replace / if-not-exists, so
-- re-running it is harmless.
-- =============================================================================

-- The statement 0028 died on. ADD VALUE IF NOT EXISTS is safe to repeat.
alter type dispute_kind add value if not exists 'sos';

-- public_reviews_for_team — from 0021_public_review_feed.sql
create or replace function public_reviews_for_team(p_team_id uuid, p_limit int default 20)
returns table (
  rating_id uuid,
  overall smallint,
  comment text,
  tags text[],
  created_at timestamptz,
  reviewer_display text  -- e.g. "Adam H."
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         r.overall,
         r.comment,
         r.tags,
         r.created_at,
         coalesce(
           split_part(p.full_name, ' ', 1)
             || ' '
             || left(coalesce(split_part(p.full_name, ' ', 2), ''), 1)
             || '.',
           'Customer'
         ) as reviewer_display
  from ratings r
  join profiles p on p.id = r.from_profile_id
  where r.to_team_id = p_team_id
    and r.party = 'customer_to_partner'
    and r.overall is not null
    and (r.comment is not null or coalesce(array_length(r.tags, 1), 0) > 0 or r.overall <= 3)
  order by r.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public_reviews_for_team(uuid, int) from public;
grant execute on function public_reviews_for_team(uuid, int) to authenticated, anon;

-- public_reviews_for_company — from 0021_public_review_feed.sql
create or replace function public_reviews_for_company(p_company_id uuid, p_limit int default 20)
returns table (
  rating_id uuid,
  overall smallint,
  comment text,
  tags text[],
  created_at timestamptz,
  reviewer_display text
) language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         r.overall,
         r.comment,
         r.tags,
         r.created_at,
         coalesce(
           split_part(p.full_name, ' ', 1)
             || ' '
             || left(coalesce(split_part(p.full_name, ' ', 2), ''), 1)
             || '.',
           'Customer'
         ) as reviewer_display
  from ratings r
  join profiles p on p.id = r.from_profile_id
  where r.to_company_id = p_company_id
    and r.party = 'customer_to_partner'
    and r.overall is not null
    and (r.comment is not null or coalesce(array_length(r.tags, 1), 0) > 0 or r.overall <= 3)
  order by r.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public_reviews_for_company(uuid, int) from public;
grant execute on function public_reviews_for_company(uuid, int) to authenticated, anon;

-- customer_booking_audit_log — from 0028_support_console.sql
create or replace function customer_booking_audit_log(p_booking_id uuid)
returns table (
  id bigint,
  action text,
  entity_type text,
  entity_id uuid,
  actor_role user_role,
  payload jsonb,
  ip_address inet,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_participant boolean;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Caller must be the customer OR the assigned driver OR admin
  select (
    b.customer_id = v_caller
    or b.assigned_driver_profile_id = v_caller
    or exists (
      select 1 from profiles p where p.id = v_caller and p.role in ('movvy_admin','movvy_support')
    )
  ) into v_is_participant
  from bookings b
  where b.id = p_booking_id;

  if not coalesce(v_is_participant, false) then
    raise exception 'Not authorised to view this audit log' using errcode = '42501';
  end if;

  return query
    select a.id, a.action, a.entity_type, a.entity_id, a.actor_role,
           -- Strip the actor_profile_id from the payload + redact IPs to /24
           -- so customers can't pivot off the audit log to fingerprint admins.
           a.payload,
           -- IP is informational for the customer (was this me? was this
           -- mine?) — truncate to /24 so we expose general location only.
           (host(network(set_masklen(a.ip_address, 24))))::inet,
           a.created_at
    from audit_logs a
    where a.entity_type = 'booking' and a.entity_id = p_booking_id
       or a.entity_type = 'dispute'
          and exists (select 1 from disputes d where d.id = a.entity_id and d.booking_id = p_booking_id)
       or a.entity_type = 'rating'
          and exists (select 1 from ratings r where r.id = a.entity_id and r.booking_id = p_booking_id)
    order by a.created_at asc;
end $$;
grant execute on function customer_booking_audit_log(uuid) to authenticated;

-- booking_audit_hash — from 0028_support_console.sql
create or replace function booking_audit_hash(p_booking_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  v_payload text;
  v_hash text;
begin
  select string_agg(
    concat(
      a.id, '|',
      a.created_at::text, '|',
      a.action, '|',
      coalesce(a.actor_role::text, ''), '|',
      coalesce(a.entity_id::text, ''), '|',
      coalesce(a.payload::text, '')
    ),
    E'\n' order by a.created_at asc, a.id asc
  )
  into v_payload
  from audit_logs a
  where (a.entity_type = 'booking' and a.entity_id = p_booking_id)
     or (a.entity_type = 'dispute'
         and exists (select 1 from disputes d where d.id = a.entity_id and d.booking_id = p_booking_id))
     or (a.entity_type = 'rating'
         and exists (select 1 from ratings r where r.id = a.entity_id and r.booking_id = p_booking_id));

  if v_payload is null then return null; end if;

  v_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  return v_hash;
end $$;
grant execute on function booking_audit_hash(uuid) to authenticated;

-- ensure_my_profile — from 0030_ensure_my_profile.sql
create or replace function ensure_my_profile()
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_phone text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from profiles where id = v_user) then
    return;
  end if;

  -- Pull the auth-row metadata so the synthesised profile matches what
  -- handle_new_user would have inserted.
  select
    email::text,
    raw_user_meta_data ->> 'full_name',
    raw_user_meta_data ->> 'phone'
  into v_email, v_full_name, v_phone
  from auth.users
  where id = v_user;

  insert into profiles (id, role, email, full_name, phone)
  values (v_user, 'customer', v_email, v_full_name, v_phone)
  on conflict (id) do nothing;
end $$;
revoke all on function ensure_my_profile() from public;
grant execute on function ensure_my_profile() to authenticated;

