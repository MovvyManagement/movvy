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

  // ─── Partner accounts belong on the partner sign-in ────────────────────────
  // A valid password is not enough: this door is the CUSTOMER app. A crew
  // account signing in here landed on the customer home with a partner's
  // session — wrong surface, and the two sides have different rules about what
  // you can see. Sign them straight back out and point them at the right door.
  // (Movvy staff keep using this screen — the console is web-only.)
  const wrongDoor = await enforceCustomerOnly();
  if (wrongDoor) return { ok: false, error: wrongDoor };

  return { ok: true };
}

/**
 * Signs the current session out and returns an error message when it belongs to
 * a partner. Returns null when the account is welcome on the customer side.
 * Exported so the OAuth buttons (Apple / Google) enforce the same rule — they
 * skip login() entirely and would otherwise be a way around it.
 */
export async function enforceCustomerOnly(): Promise<string | null> {
  if (!(await isPartnerAccount())) return null;
  await supabase.auth.signOut();
  return "That's a partner account. Sign in through 'Partner sign in' instead.";
}

/**
 * True when the signed-in account is a Movvy PARTNER rather than a customer —
 * either by profile role or by holding a live org membership. Checks both
 * because the two can drift: an operator's profile role isn't always updated
 * when they create their org, and a legacy row can outlive a role change.
 */
async function isPartnerAccount(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (profile as any)?.role ?? null;
  if (role && ['driver', 'mover', 'company_owner', 'company_dispatcher'].includes(role)) {
    return true;
  }

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('profile_id', user.id)
    .is('removed_at', null)
    .in('status', ['active', 'pending_approval'])
    .limit(1)
    .maybeSingle();
  if (membership) return true;

  const { data: teamMembership } = await supabase
    .from('partner_team_members')
    .select('team_id')
    .eq('profile_id', user.id)
    .is('removed_at', null)
    .in('status', ['active', 'pending_approval'])
    .limit(1)
    .maybeSingle();
  return !!teamMembership;
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
