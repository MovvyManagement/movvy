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
  return { ok: true };
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
//   4) if mismatch: sign out IMMEDIATELY + return error
//
// Customer login (above) does not require a code — customers don't have one.
// =============================================================================

export async function loginPartner(input: unknown): Promise<AuthResult<{ kind: 'team' | 'company'; id: string }>> {
  const parsed = LoginInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // The schema doesn't include invite_code, so we read it off the raw input.
  // We accept either the bare 6-char body ("X7QJ4M") or the full code
  // ("TM-X7QJ4M" / "CO-X7QJ4M"). Normalise to uppercase.
  const raw = (input as any)?.invite_code;
  const codeInput = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!/^(TM|CO)-[A-Z0-9]{6}$/.test(codeInput)) {
    return {
      ok: false,
      error: 'Enter your team or company invite code (TM-XXXXXX or CO-XXXXXX).',
    };
  }

  const { email, phone, password } = parsed.data;
  const creds = email ? { email, password } : { phone: phone!, password };

  const { error: signInErr } = await supabase.auth.signInWithPassword(creds);
  if (signInErr) return { ok: false, error: friendly(signInErr.message) };

  // We're signed in — now verify the code matches a team/company we belong to.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Should never happen — we just signed in. Defensive cleanup.
    await supabase.auth.signOut();
    return { ok: false, error: 'Sign-in succeeded but session is missing. Try again.' };
  }

  // Look up the team/company the code points at, then confirm membership.
  // Server-side enforcement of "currently on the roster" is via the
  // removed_at IS NULL filter — RLS will return an empty row if not a member.
  if (codeInput.startsWith('TM-')) {
    const { data: team } = await supabase
      .from('partner_teams')
      .select('id, invite_code')
      .eq('invite_code', codeInput)
      .maybeSingle();
    if (!team) {
      await supabase.auth.signOut();
      return { ok: false, error: "We couldn't find that team code." };
    }
    const { data: member } = await supabase
      .from('partner_team_members')
      .select('team_id')
      .eq('team_id', team.id)
      .eq('profile_id', user.id)
      .is('removed_at', null)
      .maybeSingle();
    if (!member) {
      // No membership yet — check for a pending invite. If one exists,
      // sign them in anyway so the InviteAcceptHost popup can prompt
      // them to Accept/Decline. The accept flow inserts the membership row.
      const hasPendingInvite = await hasPendingInviteFor(user.id, team.id, null);
      if (!hasPendingInvite) {
        await supabase.auth.signOut();
        return {
          ok: false,
          error: "You're not on this team's roster. Check your code or ask your team owner.",
        };
      }
    }
    return { ok: true, data: { kind: 'team', id: team.id } };
  }

  // CO- prefix
  const { data: company } = await supabase
    .from('companies')
    .select('id, invite_code')
    .eq('invite_code', codeInput)
    .maybeSingle();
  if (!company) {
    await supabase.auth.signOut();
    return { ok: false, error: "We couldn't find that company code." };
  }
  const { data: cm } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('company_id', company.id)
    .eq('profile_id', user.id)
    .is('removed_at', null)
    .maybeSingle();
  if (!cm) {
    // No membership row yet — see if there's a pending invite waiting.
    // If yes, sign them in so InviteAcceptHost can prompt them.
    const hasPendingInvite = await hasPendingInviteFor(user.id, null, company.id);
    if (!hasPendingInvite) {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: "You're not on this company's roster. Check your code or ask your dispatcher.",
      };
    }
  }
  return { ok: true, data: { kind: 'company', id: company.id } };
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
