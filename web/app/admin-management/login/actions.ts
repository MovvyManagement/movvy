// =============================================================================
// Server Actions for the admin login form.
// 'use server' marks this entire file as server-only — Next.js refuses
// to bundle it for the browser, so the Supabase server client (which
// touches cookies()) is safe to import here.
//
// Login flow with per-account brute-force protection:
//   1. Check rl_check_admin_login → if locked, refuse before touching Supabase
//   2. Call supabase.auth.signInWithPassword
//   3. On failure → log to auth_login_attempts + redirect with error
//   4. On success → set cookie + redirect to dashboard
// =============================================================================

'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect(
      `/admin-management/login?error=${encodeURIComponent(
        'Email and password are both required.',
      )}`,
    );
  }

  const supabase = await supabaseServer();

  // ─── Per-account brute-force gate ───────────────────────────────────────
  // Before we even hit Supabase Auth, ask the DB if this email is currently
  // locked out. This prevents credential-stuffing across IPs from ever
  // exercising the auth pipeline for a targeted account.
  const { data: lockCheck } = await supabase.rpc('rl_check_admin_login', {
    p_email: email,
  });
  if (lockCheck?.locked) {
    const minutes = Math.ceil((lockCheck.seconds_remaining ?? 0) / 60);
    redirect(
      `/admin-management/login?error=${encodeURIComponent(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      )}`,
    );
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // ─── Log the failure so future attempts can be rate-limited ───────────
    // Best-effort; if the log call fails, we still want to return the auth
    // error to the user.
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerList.get('x-real-ip') ??
      null;
    const userAgent = headerList.get('user-agent') ?? null;

    await supabase.rpc('rl_log_admin_login_failure', {
      p_email: email,
      p_ip: ip,
      p_user_agent: userAgent,
    });

    redirect(
      `/admin-management/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Successful sign-in sets the Supabase session cookie via the SSR client.
  // Stamp the console's OWN session markers alongside it: proxy.ts requires
  // both, and because they're session cookies (no maxAge) the console stops
  // trusting a Supabase token that outlives the browser window. Role gate
  // happens in the proxy on the next request.
  const now = String(Date.now());
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/admin-management',
  };
  jar.set('mv_admin_seen', now, opts);
  jar.set('mv_admin_since', now, opts);

  redirect('/admin-management/dashboard');
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const jar = await cookies();
  jar.delete('mv_admin_seen');
  jar.delete('mv_admin_since');
  redirect('/admin-management/login');
}
