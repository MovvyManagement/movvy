-- =============================================================================
-- Migration 0113 — make a referral code redeemable
--
-- 0110 built the whole back half of the referral programme: a ledger, award
-- rules for both sides, and triggers that fire on the right event. 0111 made
-- the codes collision-free. None of it ever ran, because there was no way to
-- get a row into `referrals` in the first place.
--
-- The client tried. useApplyReferralCode did:
--
--     select id from profiles where referral_code = <code>
--
-- through the signed-in user's own client. RLS on `profiles` only ever returns
-- the caller's own row, so that lookup returned zero rows for every code except
-- the caller's own. The result: every valid code was rejected as "Invalid
-- referral code", and your own was rejected as "You can't refer yourself".
-- Confirmed against production — `referrals` and `account_credits` were both
-- empty, and my_credit_balance() returned zero for every account.
--
-- This function does the lookup with definer rights so a code can actually be
-- resolved, while deliberately leaking nothing about the referrer beyond
-- "that code is real": no name, no email, no id.
--
-- WHAT IT DOESN'T DO: it does not decide the amount or the side. 0110 stamps
-- `kind` and `credit_cents` at AWARD time, from what the invitee actually did
-- — someone who joins as a customer and ends up completing moves earns the
-- driver reward. Recording a guess here would only be a value that gets
-- overwritten later.
-- =============================================================================

/**
 * Attach the caller to a referrer's code.
 *
 * Returns a jsonb verdict rather than raising, so the app can show one honest
 * sentence per outcome instead of parsing Postgres error text:
 *
 *   { ok: true,  status: 'applied' }
 *   { ok: false, status: 'unknown_code'  }  -- no profile carries that code
 *   { ok: false, status: 'self'          }  -- it's the caller's own code
 *   { ok: false, status: 'already'       }  -- caller already used a code
 *   { ok: false, status: 'too_late'      }  -- already paid for a move
 */
create or replace function apply_referral_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_ref   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'status', 'unauthenticated');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'status', 'unknown_code');
  end if;

  select id into v_ref from profiles
   where upper(referral_code) = v_code
     and deleted_at is null
   limit 1;

  if v_ref is null then
    return jsonb_build_object('ok', false, 'status', 'unknown_code');
  end if;
  if v_ref = v_uid then
    return jsonb_build_object('ok', false, 'status', 'self');
  end if;

  -- One code per account, ever. Checked before the too_late test so someone
  -- who already applied a code gets the accurate reason.
  if exists (select 1 from referrals where referred_profile_id = v_uid) then
    return jsonb_build_object('ok', false, 'status', 'already');
  end if;

  -- The customer rule in 0110 only fires on a customer's FIRST paid booking.
  -- Someone who has already paid for a move can never trigger it, so a code
  -- entered now would sit 'pending' forever. Say so instead of accepting a row
  -- that will never pay. Crews are exempt: their rule fires on ANY completed
  -- job, so a code entered late still earns on the next one.
  if exists (
    select 1 from bookings b
     where b.customer_id = v_uid and b.deposit_status = 'paid'
  ) and not exists (
    select 1 from company_members m
     where m.profile_id = v_uid and m.status = 'active' and m.removed_at is null
  ) then
    return jsonb_build_object('ok', false, 'status', 'too_late');
  end if;

  -- credit_cents carries 0110's default and is overwritten at award time; it
  -- is not the promise, the award rule is.
  insert into referrals (
    referrer_profile_id, referred_profile_id, referral_code_used, status
  )
  values (v_ref, v_uid, v_code, 'pending')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'status', 'applied');
end $$;

grant execute on function apply_referral_code(text) to authenticated;

-- One referral per invitee, enforced by the database rather than by the check
-- above being reached. Two devices submitting the same code at once, or a
-- retried request, land on the constraint instead of creating a second row.
create unique index if not exists referrals_one_per_referred
  on referrals (referred_profile_id);

notify pgrst, 'reload schema';
