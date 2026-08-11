'use server';

// =============================================================================
// startConsoleSession — stamp the console's own session markers after a
// successful password reset.
//
// Without this, resetting your admin password appeared to fail. The form
// promised "you'll be signed in", cleared the recovery lock and pushed to the
// dashboard — but proxy.ts requires BOTH mv_admin_seen and mv_admin_since
// alongside the Supabase token, and only login/actions.ts ever wrote them. So
// the proxy saw a valid token with no console markers, hit
//
//     if (!seen || !since) return signOutTo(request, 'Please sign in again.')
//
// and bounced you to the login screen. The reset had actually worked; it just
// read as though it hadn't, which is the worst possible outcome for a password
// flow — the natural next move is to reset again.
//
// This has to be a server action: the markers are httpOnly, so the browser
// client that performs the reset cannot write them.
//
// It deliberately does NOT decide whether you're allowed in. The role gate
// stays in the proxy on the next request, exactly as it does after a normal
// login. All this asserts is "a real session exists right now", which is why it
// re-reads the user from the cookie jar rather than trusting the caller.
// =============================================================================

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

export async function startConsoleSession(): Promise<{ ok: boolean }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  // No session means nothing to stamp — the caller falls back to sending the
  // user to login, which is the honest outcome rather than a half-open console.
  if (!user) return { ok: false };

  const now = String(Date.now());
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    // Same path login/actions.ts uses. A mismatch here writes cookies the
    // proxy cannot read, which would look exactly like the bug being fixed.
    path: '/admin-management',
  };
  jar.set('mv_admin_seen', now, opts);
  jar.set('mv_admin_since', now, opts);

  return { ok: true };
}
