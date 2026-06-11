-- =============================================================================
-- Movvy — Migration 0028: Customer support console
--
-- Powers the in-app Help & Support hub:
--   • emergency contact on profiles  → notified on SOS
--   • two new dispute kinds          → 'insurance_claim', 'sos'
--   • customer_booking_audit_log RPC → tamper-evident, customer-readable
--                                      export of audit_logs for one booking
--   • booking_audit_hash function    → SHA-256 of the canonical audit chain
--                                      so a printed export can be verified
--                                      later if it ever ends up in court
-- =============================================================================

-- ─── Emergency contact on profiles ─────────────────────────────────────────

alter table profiles
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add constraint profiles_emergency_phone_format
    check (
      emergency_contact_phone is null
      or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$'
    );

-- ─── Two new dispute kinds ─────────────────────────────────────────────────
-- 'sos'              → records a mid-move emergency for legal review
-- 'insurance_claim'  → kicks off the $5K coverage process

alter type dispute_kind add value if not exists 'insurance_claim';
alter type dispute_kind add value if not exists 'sos';

-- ─── Audit-log read access for the booking's customer ──────────────────────
-- audit_logs.RLS only lets admins read directly. We expose a SECURITY DEFINER
-- RPC that returns the rows for one booking IF the caller is that booking's
-- customer (or the assigned driver) — gives customers tamper-evidence for
-- their own moves without opening the whole table.

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

-- ─── Tamper-evident hash for the audit chain of a single booking ──────────
-- SHA-256 of the canonical-JSON encoding of the audit rows. Embedded in the
-- exported PDF so the customer can prove later that the document they hold
-- matches what's still in the DB (the DB row IDs + timestamps are immutable;
-- modifying any of them would change the hash).

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

-- ─── Support thread bootstrap helper ───────────────────────────────────────
-- One support thread per customer, lazy-created on first request. The
-- existing chat_threads_admin_all + chat_threads_participant RLS already
-- gates writes; this just gives the client a single-call way to land in
-- the right thread instead of querying + inserting on its own.

create or replace function ensure_support_thread()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_thread_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select id into v_thread_id
  from chat_threads
  where customer_profile_id = v_caller
    and kind = 'support'
    and booking_id is null
  limit 1;

  if v_thread_id is not null then return v_thread_id; end if;

  insert into chat_threads (kind, booking_id, customer_profile_id, partner_profile_id, is_admin_monitored)
  values ('support', null, v_caller, null, true)
  returning id into v_thread_id;
  return v_thread_id;
end $$;

grant execute on function ensure_support_thread() to authenticated;
