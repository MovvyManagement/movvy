-- =============================================================================
-- Migration 0125 — admin access trusts the verified sign-in email only
--
-- movvy_admin_access() decided who is management or staff by matching
-- profiles.email against the root address and the employee allowlist. But
-- profiles.email is a field every signed-in user can edit on their own row
-- (profiles_update_own, plus the UPDATE grant on the column). So any customer
-- could set their profile email to management@movvy.ca, or to an employee's
-- address, and be treated as that admin by everything that asks this
-- function: admin-console (employee management), admin-refund-booking (moves
-- money), admin_refunds_owed (customer names and emails), and the console
-- layout itself. Found Nov 16 2026; a phone-only test account already had
-- management@movvy.ca in its profile and therefore resolved to management.
--
-- The email now comes from auth.users, and only once Supabase has confirmed
-- it. A user cannot write auth.users.email without proving they own the inbox,
-- so the allowlist means what it says again.
--
-- Nobody legitimate loses access: the founder is movvy_admin by role, the one
-- allowlist row (management@movvy.ca) belongs to an auth user with a
-- confirmed email, and legacy movvy_support agents still resolve by role.
-- =============================================================================

create or replace function movvy_admin_access()
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role   user_role;
  v_email  text;
  v_member admin_members%rowtype;
begin
  select p.role,
         case when u.email_confirmed_at is not null then lower(u.email) end
    into v_role, v_email
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();

  if v_role is null then
    return null;
  end if;

  -- Founder / root bootstrap — always management, never blockable.
  if v_role = 'movvy_admin' or v_email = 'management@movvy.ca' then
    return 'management';
  end if;

  -- Employee allowlist, matched on the VERIFIED sign-in email, honouring
  -- `blocked`.
  if v_email is not null then
    select * into v_member from admin_members where lower(email) = v_email;
    if found then
      if v_member.blocked then
        return null;                 -- explicitly locked out
      end if;
      return v_member.access_level;
    end if;
  end if;

  -- Legacy support agents (not in the allowlist) get staff access.
  if v_role = 'movvy_support' then
    return 'staff';
  end if;

  return null;
end;
$$;

comment on function movvy_admin_access() is
  'Admin console tier for the caller: management, staff, or null. Matches the allowlist on the confirmed auth.users email, never the user-editable profiles.email.';
