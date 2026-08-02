-- =============================================================================
-- 0075 — Anonymize account on delete (obscure PII instead of hard-deleting).
--
-- Hard-deleting a profile/auth user in a live app breaks — bookings, payouts,
-- receipts, chat, audit rows reference it, so the delete either fails on a FK
-- or cascades away records we must keep for legal/financial reasons. The right
-- pattern (and what the app already half-does) is a SOFT delete: keep the row,
-- null out the PII, and block sign-in.
--
-- This extends request_account_deletion to also redact the email (it only
-- nulled full_name + phone before), so no personal data lingers on the row.
-- The edge function additionally bans the auth user so a "deleted" account can
-- no longer sign back in. Email becomes a stable, non-identifying placeholder
-- (the column is used in unique lookups, so we keep it unique per id rather
-- than NULL).
-- =============================================================================

create or replace function request_account_deletion(p_profile_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update profiles
    set deleted_at = now(),
        suspended_reason = coalesce(p_reason, 'Account deleted by user'),
        is_suspended = true,
        full_name = null,
        phone = null,
        email = 'deleted+' || p_profile_id::text || '@deleted.movvy.ca'
    where id = p_profile_id;
  delete from saved_addresses where profile_id = p_profile_id;
  delete from device_tokens where profile_id = p_profile_id;
end $$;

grant execute on function request_account_deletion(uuid, text) to service_role;
