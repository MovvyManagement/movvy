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

// ── Session lifetime ────────────────────────────────────────────────────────
// Supabase's own auth cookie is long-lived and survives a browser restart, so
// the console would let someone back in weeks later with no password — on a
// surface that shows customer addresses, phone numbers and payouts. These two
// markers pin the console to a real working session:
//
//   • ACTIVITY_COOKIE is a SESSION cookie (no maxAge) → the browser drops it
//     when it closes, so the next visit has to sign in even though Supabase
//     still considers the token valid.
//   • Its value is the last-seen timestamp → an idle console locks itself.
//   • ONSET_COOKIE caps the whole session, idle or not.
//
// Anything expired is signed out here, in front of every admin route, rather
// than trusted to a page-level check.
const ACTIVITY_COOKIE = 'mv_admin_seen';
const ONSET_COOKIE = 'mv_admin_since';
const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes untouched
const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000; // 12 hours since sign-in

/**
 * Drop every auth cookie and send the caller to login. Supabase names its
 * cookies `sb-<project-ref>-auth-token[.N]`, so we clear by prefix rather than
 * guessing the ref — a chunked token left behind would re-authenticate them.
 */
function signOutTo(request: NextRequest, reason: string) {
  const url = new URL(AUTH_PREFIX, request.url);
  url.searchParams.set('error', reason);
  const res = NextResponse.redirect(url);
  for (const c of request.cookies.getAll()) {
    // Path has to match the one the cookie was written with or the browser
    // keeps it: Supabase writes at '/', our own markers at the admin subtree.
    if (c.name.startsWith('sb-')) {
      res.cookies.set(c.name, '', { path: '/', maxAge: 0 });
    } else if (c.name === ACTIVITY_COOKIE || c.name === ONSET_COOKIE) {
      res.cookies.set(c.name, '', { path: ADMIN_PREFIX, maxAge: 0 });
    }
  }
  return res;
}

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

  // ── Session lifetime enforcement ─────────────────────────────────────────
  // A valid Supabase token is necessary but NOT sufficient: the console also
  // requires a live browser session that has been touched recently. Runs before
  // the login-page redirect below, so a stale token can't bounce someone
  // straight into the dashboard without ever typing a password.
  const now = Date.now();
  const seen = Number(request.cookies.get(ACTIVITY_COOKIE)?.value ?? 0);
  const since = Number(request.cookies.get(ONSET_COOKIE)?.value ?? 0);
  const liveConsoleSession =
    !!seen && !!since && now - seen <= IDLE_LIMIT_MS && now - since <= ABSOLUTE_LIMIT_MS;

  // The public admin paths are deliberately exempt: login needs to render, and
  // reset-password runs on a recovery session that has no markers yet.
  if (user && !isPublicPath) {
    if (!seen || !since) {
      // Token outlived the browser session (restart), or predates this rule.
      return signOutTo(request, 'Please sign in again.');
    }
    if (now - seen > IDLE_LIMIT_MS) {
      return signOutTo(request, 'Signed out after 30 minutes of inactivity.');
    }
    if (now - since > ABSOLUTE_LIMIT_MS) {
      return signOutTo(request, 'Your session expired. Sign in again.');
    }
    // Slide the idle window forward. Session cookie on purpose — closing the
    // browser must end console access.
    response.cookies.set(ACTIVITY_COOKIE, String(now), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: ADMIN_PREFIX,
    });
  }

  // Authenticated user hitting the login page → send them to the dashboard
  // (avoids a "back to login" loop after signing in). Only when the console
  // session is actually live: a leftover Supabase token must land on the form,
  // not be waved through.
  if (user && liveConsoleSession && pathname.startsWith(AUTH_PREFIX)) {
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
