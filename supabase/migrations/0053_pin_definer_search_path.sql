-- =============================================================================
-- Movvy — Migration 0053: Pin search_path on SECURITY DEFINER functions
--
-- Security hardening. A SECURITY DEFINER function runs with the OWNER's
-- privileges, so if its `search_path` is attacker-influenced it can be tricked
-- into calling a malicious same-named object (the classic CVE-2018-1058 class).
-- Every other DEFINER function in this project already pins
-- `set search_path = public, pg_temp`; these four predate that convention and
-- were missed:
--   • find_partner_invite            (0016)
--   • notify_customer_welcome        (0048)
--   • notify_partner_welcome         (0048)
--   • sync_subject_background_check  (0049)
--
-- We ALTER (not CREATE OR REPLACE) so each body stays byte-for-byte untouched —
-- notably notify_customer_welcome / notify_partner_welcome embed the DB webhook
-- secret inline, and rewriting them here would re-commit that secret. (Rotating
-- it + moving it to Vault is a separate, dashboard-side follow-up.)
--
-- The signature is looked up from pg_proc at run time rather than hard-coded:
-- one of these functions has drifted from its original migration signature, and
-- oid::regprocedure always yields the exact current identity ALTER FUNCTION
-- needs. Any function that no longer exists is simply skipped (nothing to pin,
-- nothing at risk). pg_temp is pinned LAST so a session-local temp object can
-- never shadow a public one mid-execution.
-- =============================================================================

do $$
declare
  target_fn record;
begin
  for target_fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_partner_invite',
        'notify_customer_welcome',
        'notify_partner_welcome',
        'sync_subject_background_check'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', target_fn.sig);
  end loop;
end $$;
