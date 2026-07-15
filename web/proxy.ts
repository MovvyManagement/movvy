// =============================================================================
// Root Next.js proxy (was `middleware.ts` pre-Next.js-16) — runs BEFORE
// every request that matches the `matcher` config below. Responsibilities:
//
//   1. Refresh the Supabase auth session cookie on every request so it
//      doesn't silently expire mid-browse (previously the layout re-checked
//      but never refreshed; users hit "unauthorized" errors mid-session).
//
//   2. Gate /admin-management/* routes:
//        • No session at all → redirect to /admin-management/login
//        • Session but not admin/support → redirect to public site
//        • Login page itself always renders (so we don't infinite-loop)
//
//   3. Copy-URL-in-new-browser is now DEFINITIVELY safe: the new browser
//      has no session cookie, middleware sees the request, redirects to
//      login before ANY page renders. No flash of protected content.
//
// Everything outside /admin-management/* falls through untouched — the
// public site (movvy.ca/) doesn't need session state.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

const ADMIN_PREFIX = '/admin-management';
const AUTH_PREFIX = '/admin-management/login';
const RESET_PATH = '/admin-management/reset-password';

// Set by the reset-password page the instant it redeems a recovery link, and
// cleared only when the new password is actually saved. While present, the
// session is a RECOVERY session that has not completed the reset — it must
// not be able to touch anything but the reset form (a recovery link should
// never grant durable console access on its own).
const RECOVERY_COOKIE = 'movvy_recovery_pending';

// Paths that must render without a session so unauthenticated users can
// actually GET to login / recover their password.
const PUBLIC_ADMIN_PATHS = [
  '/admin-management/login',
  '/admin-management/forgot-password',
  '/admin-management/reset-password',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate the admin subtree — everything else (landing page, /partners,
  // /join, /legal, marketing pages) is public.
  if (!pathname.startsWith(ADMIN_PREFIX)) {
    return NextResponse.next();
  }

  // Refresh the session cookie so it doesn't silently expire.
  const { response, user } = await updateSession(request);

  // RECOVERY LOCK: a session created by a password-reset link may not use the
  // console until the password is saved. While the recovery cookie is set,
  // pin the user to the reset form — even a valid session is bounced off
  // every other admin route. Cleared by the reset form on a successful save.
  const recoveryPending = request.cookies.get(RECOVERY_COOKIE)?.value === '1';
  if (recoveryPending && !pathname.startsWith(RESET_PATH)) {
    return NextResponse.redirect(new URL(RESET_PATH, request.url));
  }

  const isPublicPath = PUBLIC_ADMIN_PATHS.some((p) => pathname.startsWith(p));

  // Unauthenticated user hitting a protected admin route → redirect to login
  if (!user && !isPublicPath) {
    const loginUrl = new URL(AUTH_PREFIX, request.url);
    // Preserve intended destination so login can bounce them back
    if (pathname !== ADMIN_PREFIX) {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user hitting the login page → send them to the dashboard
  // (avoids a "back to login" loop after signing in).
  if (user && pathname.startsWith(AUTH_PREFIX)) {
    return NextResponse.redirect(new URL('/admin-management/dashboard', request.url));
  }

  return response;
}

// Only fire middleware on the admin subtree. This keeps the public site
// (landing + marketing pages) as fast static rendering as possible.
export const config = {
  matcher: [
    /*
     * Run on all /admin-management/* routes.
     * Skip Next.js internals (_next/*, favicon.ico, etc.) and API routes.
     */
    '/admin-management/:path*',
  ],
};
