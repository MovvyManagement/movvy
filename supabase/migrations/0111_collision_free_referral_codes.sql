-- =============================================================================
-- Migration 0111 — referral codes that cannot collide
--
-- The old generator guessed and checked:
--
--     loop
--       v_code := 'MOV' || 4 random base32 chars;
--       exit when not exists (select 1 from profiles where referral_code = v_code);
--     end loop;
--
-- Two problems.
--
-- 1. A RACE. Two signups running concurrently can both pass the `not exists`
--    check and generate the same code. The unique constraint then rejects the
--    loser — which means a SIGNUP FAILS, with an opaque database error, for a
--    reason that has nothing to do with the person signing up. Rare at 14
--    users; a support ticket you can't reproduce at 10,000.
--
-- 2. A SMALL SPACE. 32^4 is 1,048,576. By the birthday bound, collisions start
--    showing up in the retry loop after roughly a thousand codes, so the loop
--    gets hotter as the product grows — and the fallback path appends a uuid
--    fragment, producing a visibly different, uglier code for those users.
--
-- Both go away by not guessing. A sequence is unique by definition, so this
-- maps sequence values onto codes with a BIJECTION: multiply by an odd
-- constant modulo 2^25 (= 32^5). Odd multipliers are invertible mod a power of
-- two, so distinct inputs give distinct outputs — no collisions, no loop, no
-- check, no race. The multiply also scatters consecutive values across the
-- space, so codes don't come out as MOVAAAB, MOVAAAC, which would let anyone
-- guess a valid referrer.
--
-- 32^5 = 33,554,432 codes. Five characters instead of four; still short enough
-- to read down a phone.
--
-- Existing codes are left exactly as they are — they're printed on screens and
-- possibly already shared.
-- =============================================================================

create sequence if not exists referral_code_seq as bigint start 1;

create or replace function gen_referral_code()
returns text language plpgsql as $$
declare
  -- No I, O, 0 or 1 — they're the characters people mistype when reading a
  -- code aloud or off a screen.
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_space bigint := 33554432;          -- 32^5 = 2^25
  -- Odd, so it's coprime with 2^25 and therefore invertible mod v_space:
  -- the map n -> n*k mod 2^25 is a bijection over the whole range.
  v_mult bigint := 2654435761;
  v_n bigint;
  v_code text := '';
begin
  v_n := (nextval('referral_code_seq') * v_mult) % v_space;

  -- Base32 into exactly 5 characters, most significant first.
  for i in reverse 4..0 loop
    v_code := v_code || substr(v_chars, 1 + ((v_n / (32 ^ i)::bigint) % 32)::int, 1);
  end loop;

  return 'MOV' || v_code;
end $$;

-- The trigger is unchanged in shape: assign only when one isn't supplied.
create or replace function profiles_assign_referral_code()
returns trigger language plpgsql as $$
begin
  if new.referral_code is null then
    new.referral_code := gen_referral_code();
  end if;
  return new;
end $$;

drop trigger if exists profiles_set_referral_code on profiles;
create trigger profiles_set_referral_code
  before insert on profiles
  for each row execute function profiles_assign_referral_code();

-- Backfill anything that somehow has no code. Row-by-row on purpose: a single
-- set-based UPDATE calling gen_referral_code() per row was how the original
-- migration risked handing two rows the same value, because each call tested
-- against the pre-statement snapshot. The sequence makes that impossible now,
-- but the loop also keeps this readable about what it's doing.
do $$
declare r record;
begin
  for r in select id from profiles where referral_code is null loop
    update profiles set referral_code = gen_referral_code() where id = r.id;
  end loop;
end $$;

-- The unique constraint stays as a backstop. It should now be unreachable —
-- if it ever fires, the bijection assumption has been broken and that is worth
-- a loud failure rather than a silent duplicate.
create unique index if not exists profiles_referral_code_key_idx
  on profiles (referral_code) where referral_code is not null;

notify pgrst, 'reload schema';
