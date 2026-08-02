-- =============================================================================
-- 0074 — Make the "must be verified to perform a move" gate toggleable.
--
-- can_take_jobs() is fail-closed: a performer must have verification_status =
-- 'approved' AND every required document approved. That's correct for real
-- launch, but it blocks EVERY freshly-signed-up operator from being assigned /
-- self-assigning a move — so the accept → assign → perform flow can't be tested
-- end to end until someone manually approves each account.
--
-- This adds a feature flag `verification_gating_enabled`. While it's OFF the
-- gate is bypassed (anyone active can be assigned), so the whole flow works for
-- testing. FLIP IT ON before onboarding real crews:
--   update feature_flags set enabled = true where key = 'verification_gating_enabled';
-- =============================================================================

insert into feature_flags (key, enabled, description) values
  ('verification_gating_enabled', false,
   'Require approved ID/background verification before a performer can be assigned a move. OFF = bypass (testing). Turn ON before real launch.')
on conflict (key) do nothing;

create or replace function can_take_jobs(p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_required text[];
  v_doc text;
  v_count int;
  v_enabled boolean;
begin
  -- Kill switch: while verification gating is disabled, anyone can perform.
  select enabled into v_enabled from feature_flags where key = 'verification_gating_enabled';
  if v_enabled is null or v_enabled = false then
    return true;
  end if;

  select verification_status::text into v_status from profiles where id = p_profile_id;
  if v_status is null then return false; end if;
  if v_status <> 'approved' then return false; end if;

  v_required := required_documents_for_profile(p_profile_id);
  foreach v_doc in array v_required loop
    select count(*) into v_count
    from verification_documents
    where profile_id = p_profile_id
      and kind::text = v_doc
      and status = 'approved';
    if v_count < 1 then return false; end if;
  end loop;

  return true;
end $$;
