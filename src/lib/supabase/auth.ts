// Auth helpers — thin wrappers around supabase.auth with friendly error messages
// and consistent return shapes for the UI to consume.

import { supabase } from './client';
import { SignupInput, LoginInput, ForgotPasswordInput } from '@/lib/validation';

export interface AuthResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

// Translate Supabase auth error messages into user-friendly text.
function friendly(msg: string | undefined): string {
  if (!msg) return 'Something went wrong. Try again.';
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Email/phone or password is incorrect.';
  if (m.includes('email not confirmed')) return 'Please verify your email first.';
  if (m.includes('phone not confirmed')) return 'Please verify your phone first via the SMS code we sent.';
  if (m.includes('user already registered')) return 'An account with that email already exists.';
  if (m.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('phone') && (m.includes('disabled') || m.includes('not enabled')))
    return 'Phone sign-in needs Twilio configured in Supabase Auth. Use email for now.';
  if (m.includes('password')) return msg;
  return msg;
}

export async function signupCustomer(input: unknown): Promise<AuthResult> {
  // Client-side validation first — server validates again as defense in depth.
  const parsed = SignupInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { full_name, email, phone, password } = parsed.data;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, phone, role: 'customer' },
    },
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

export async function login(input: unknown): Promise<AuthResult> {
  const parsed = LoginInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // signInWithPassword accepts EITHER an email or a phone; the union is enforced
  // by zod above (exactly one), so we can branch confidently here.
  const { email, phone, password } = parsed.data;
  const creds = email ? { email, password } : { phone: phone!, password };
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) return { ok: false, error: friendly(error.message) };

  // ─── This door is the CUSTOMER side ───────────────────────────────────────
  // A valid password is not enough. The two sides are separate registrations
  // (migration 0086): proving who you are opens nothing on its own — you also
  // have to have registered HERE. Someone who wants both signs up on both.
  const wrongDoor = await enforceCustomerOnly();
  if (wrongDoor) return { ok: false, error: wrongDoor };

  return { ok: true };
}

export interface AccountSides {
  customer: boolean;
  partner: boolean;
}

/** Which sides this identity has registered on. Both false until they sign up. */
export async function accountSides(): Promise<AccountSides> {
  const { data, error } = await supabase.rpc('my_account_sides');
  if (error) return { customer: false, partner: false };
  return {
    customer: !!(data as any)?.customer,
    partner: !!(data as any)?.partner,
  };
}

/**
 * Which partner surface this account belongs on: the admin dashboard or the
 * crew surface. Mirrors how loginPartner routes — a joined crew wins over your
 * own org, and only an org ADMIN gets the surface with pricing and dispatch on
 * it. Returns null when there's no membership yet.
 */
export async function myPartnerSurface(): Promise<'admin' | 'crew' | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('company_members')
    .select('org_role')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .is('removed_at', null);
  const rows = data ?? [];
  if (rows.length === 0) return null;
  // A joined crew membership is the context they're working in.
  if (rows.some((r: any) => r.org_role === 'crew')) return 'crew';
  return rows.some((r: any) => r.org_role === 'admin') ? 'admin' : 'crew';
}

/** Adds the given side to the identity that is currently signed in. */
export async function registerAccountSide(side: 'customer' | 'partner'): Promise<boolean> {
  const { error } = await supabase.rpc('register_account_side', { p_side: side });
  return !error;
}

/**
 * Second-side registration for someone who ALREADY has a Movvy login.
 *
 * Supabase keys accounts by phone/email and refuses a duplicate, so a partner
 * who wants to book a move as a customer can't sign up again with the same
 * number — the form just says "already registered". This is the way through:
 * prove the existing password, then add the side. One identity, two
 * registrations, which is exactly the separation without forcing a second
 * email address on anyone.
 */
export async function registerOtherSide(args: {
  phone: string;
  password: string;
  side: 'customer' | 'partner';
}): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({
    phone: args.phone,
    password: args.password,
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('invalid login')) {
      return {
        ok: false,
        error:
          "That's not the password for the Movvy account on this number. Use it, or reset it from the sign-in screen.",
      };
    }
    return { ok: false, error: friendly(error.message) };
  }
  const added = await registerAccountSide(args.side);
  if (!added) {
    await supabase.auth.signOut();
    return { ok: false, error: "Couldn't add that account. Try again." };
  }
  return { ok: true };
}

/**
 * Signs the current session out and returns an error message when it belongs to
 * a partner. Returns null when the account is welcome on the customer side.
 * Exported so the OAuth buttons (Apple / Google) enforce the same rule — they
 * skip login() entirely and would otherwise be a way around it.
 */
export async function enforceCustomerOnly(): Promise<string | null> {
  const sides = await accountSides();
  if (sides.customer) return null;
  await supabase.auth.signOut();
  return sides.partner
    ? "That login is registered on the partner side. Create a customer account to book a move — you can reuse this email."
    : 'No customer account found for that login. Create one to book a move.';
}

// =============================================================================
// PARTNER LOGIN (drivers, movers, company members, dispatchers)
//
// Two-factor by design: password proves you're you, and the company invite
// code proves you're STILL on the team. If the company rotates the code or
// removes you from the roster, your normal credentials stop working here.
//
// Flow:
//   1) sign in normally (email/phone + password)
//   2) look up the user's partner_team_members / company_members rows
//   3) verify the invite_code matches a team/company they currently belong to
//   4) branch on membership status (Option C self-join flow):
//        • active           → straight through to the dashboard
//        • pending_approval → signed in, but flagged so the caller routes to
//                             the waiting-for-approval screen
//        • rejected         → sign out IMMEDIATELY + friendly error
//        • off-roster       → sign out (unless a legacy pending invite exists)
//
// Customer login (above) does not require a code — customers don't have one.
// =============================================================================

export async function loginPartner(
  input: unknown,
): Promise<
  AuthResult<{
    kind: 'team' | 'company';
    id: string;
    status: 'active' | 'pending_approval';
    // Merged model: admins run the org (see prices, assign); crew perform moves
    // and never see money. Drives which partner surface we land them on.
    org_role?: 'admin' | 'crew' | null;
    // True when the account exists but has no org yet (signed up, never finished
    // onboarding) — the caller routes them into onboarding to finish.
    needsOnboarding?: boolean;
  }>
> {
  const parsed = LoginInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const { email, phone, password } = parsed.data;
  const creds = email ? { email, password } : { phone: phone!, password };

  const { error: signInErr } = await supabase.auth.signInWithPassword(creds);
  if (signInErr) return { ok: false, error: friendly(signInErr.message) };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    await supabase.auth.signOut();
    return { ok: false, error: 'Sign-in succeeded but session is missing. Try again.' };
  }

  // ─── This door is the PARTNER side ────────────────────────────────────────
  // Mirror of the customer check: a customer's credentials are valid, but they
  // have not registered as a partner, so this portal stays shut. Registering
  // (same email is fine) is what opens it — see migration 0086.
  const sides = await accountSides();
  if (!sides.partner) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: sides.customer
        ? "That login is registered on the customer side. Tap 'Create your account' to register as a partner — you can reuse this email."
        : 'No partner account found for that login. Create one to start taking jobs.',
    };
  }

  // Operator model: no invite code at login — your credentials ARE your access.
  // Resolve which org you're working in from your active memberships: a crew
  // you've JOINED wins over your OWN org (created at signup). The CO- code is
  // only used later, from the profile, to join someone's crew.
  const { data: memberships } = await supabase
    .from('company_members')
    .select('company_id, org_role, status')
    .eq('profile_id', user.id)
    .is('removed_at', null);

  const active = (memberships ?? []).filter(
    (m: any) => m.status === 'active' || m.status === 'pending_approval',
  );
  const chosen =
    active.find((m: any) => m.org_role === 'crew') ??
    active.find((m: any) => m.org_role === 'admin') ??
    active[0] ??
    null;

  if (!chosen) {
    // Signed up but never finished creating their org — let them through so the
    // caller routes them into onboarding to finish setup.
    return {
      ok: true,
      data: { kind: 'company', id: '', status: 'active', org_role: null, needsOnboarding: true },
    };
  }

  return {
    ok: true,
    data: {
      kind: 'company',
      id: (chosen as any).company_id,
      status: (chosen as any).status as 'active' | 'pending_approval',
      org_role: ((chosen as any).org_role ?? 'crew') as 'admin' | 'crew',
    },
  };
}

/**
 * Helper for loginPartner — returns true if the signed-in user's profile
 * email/phone matches a pending/sent invite for the given team or company.
 * Lets newly-invited drivers sign in before they've explicitly accepted
 * the invite popup.
 */
async function hasPendingInviteFor(
  userId: string,
  teamId: string | null,
  companyId: string | null,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone')
    .eq('id', userId)
    .single();
  const email = (profile?.email ?? '').toLowerCase();
  const phone = profile?.phone ?? '';
  const conditions: string[] = [];
  if (email) conditions.push(`email.eq.${email}`);
  if (phone) conditions.push(`phone.eq.${phone}`);
  if (conditions.length === 0) return false;

  let query = supabase
    .from('partner_invites')
    .select('id')
    .in('status', ['pending', 'sent'])
    .gt('expires_at', new Date().toISOString())
    .or(conditions.join(','))
    .limit(1);
  if (teamId) query = query.eq('team_id', teamId);
  if (companyId) query = query.eq('company_id', companyId);

  const { data } = await query;
  return (data ?? []).length > 0;
}

export async function logout(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

// =============================================================================
// PASSWORD RESET — a 6-digit code, not a link.
//
// The old flow emailed a magic link pointing at movvy://reset-password, a route
// that never existed: the link opened the app onto nothing and anyone who
// forgot their password was simply locked out. Links are also the fragile part
// of a mobile reset — they break when the mail app opens its own browser, and
// they can't be delivered by SMS at all.
//
// So: send a code, type the code, choose a password. Same three steps for
// customers and partners, by email or by phone.
//
// Mechanically this is Supabase's one-time-password sign-in. Verifying the code
// yields a real session, and a session is what lets updateUser() set a new
// password. shouldCreateUser:false is essential — without it, entering an
// unknown address would silently CREATE an account instead of resetting one.
// =============================================================================

/** Step 1 — send the code. */
export async function sendPasswordResetCode(
  contact: { email?: string; phone?: string },
): Promise<AuthResult> {
  const email = contact.email?.trim().toLowerCase();
  const phone = contact.phone?.trim();
  if (!email && !phone) return { ok: false, error: 'Enter your email or phone number.' };

  const { error } = await supabase.auth.signInWithOtp(
    email
      ? { email, options: { shouldCreateUser: false } }
      : { phone: phone!, options: { shouldCreateUser: false } },
  );
  if (error) {
    const m = error.message.toLowerCase();
    // Supabase says "signups not allowed for otp" when the contact has no
    // account. Don't confirm or deny it — that would let anyone test which
    // emails and numbers are registered.
    if (m.includes('signups not allowed') || m.includes('not found')) return { ok: true };
    return { ok: false, error: friendly(error.message) };
  }
  return { ok: true };
}

/** Step 2 — check the code. A correct one leaves us signed in. */
export async function verifyPasswordResetCode(
  contact: { email?: string; phone?: string },
  code: string,
): Promise<AuthResult> {
  const email = contact.email?.trim().toLowerCase();
  const phone = contact.phone?.trim();
  const token = code.replace(/\D/g, '');
  if (token.length < 6) return { ok: false, error: 'Enter the 6-digit code.' };

  const { error } = await supabase.auth.verifyOtp(
    email
      ? { email, token, type: 'email' }
      : { phone: phone!, token, type: 'sms' },
  );
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('expired')) {
      return { ok: false, error: 'That code expired. Send a new one.' };
    }
    return { ok: false, error: "That code didn't match. Check it and try again." };
  }
  return { ok: true };
}

/** Step 3 — set the new password on the session the code just created. */
export async function setNewPassword(password: string): Promise<AuthResult> {
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

/** @deprecated Link-based reset — kept only for the web console's own flow. */
export async function resetPassword(input: unknown): Promise<AuthResult> {
  const parsed = ForgotPasswordInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: 'movvy://reset-password',
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

export async function getCurrentProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return data;
}
