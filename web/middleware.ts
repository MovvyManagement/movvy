// =============================================================================
// Project-root middleware — runs before every request that matches the
// `config.matcher` below. We use it for two things:
//
//   1. Refresh the Supabase auth session (so it doesn't expire mid-browse).
//   2. Gate /admin-management/* — unsigned users get punted to the login
//      page, signed-in non-admins get punted back to the public landing.
//
// Role enforcement happens HERE at the middleware layer rather than only
// inside each Server Component, so a leaked URL can't render even briefly
// before the role check runs.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';

const ADMIN_ROLES = new Set(['movvy_admin', 'movvy_support']);

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  // Login page is the one /admin-management route that DOESN'T require auth.
  // Anonymous users land here. Already-signed-in admins get bounced to the
  // dashboard so they don't have to sign in again.
  if (pathname.startsWith('/admin-management/login')) {
    if (user) {
      // Verify role before letting them skip the login form.
      const role = await fetchRole(request, user.id);
      if (role && ADMIN_ROLES.has(role)) {
        return NextResponse.redirect(
          new URL('/admin-management/dashboard', request.url),
        );
      }
    }
    return response;
  }

  // Everything else under /admin-management requires a signed-in admin.
  if (pathname.startsWith('/admin-management')) {
    if (!user) {
      return NextResponse.redirect(
        new URL('/admin-management/login', request.url),
      );
    }
    const role = await fetchRole(request, user.id);
    if (!role || !ADMIN_ROLES.has(role)) {
      // Signed in as a non-admin (customer or driver) — kick to public site.
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return response;
}

// One-shot role lookup. We don't cache here — the request middleware
// runs on every navigation, so a stale cache could lock out a just-promoted
// admin. Hits a single indexed `select` against profiles via the anon key
// + the user's session cookie, so RLS still applies.
async function fetchRole(
  request: NextRequest,
  userId: string,
): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          /* read-only here */
        },
      },
    },
  );
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return (data as { role?: string } | null)?.role ?? null;
}

export const config = {
  // Match all /admin-management/* routes. Static assets, the public landing,
  // and the existing /partners/legal/privacy routes are left untouched.
  matcher: ['/admin-management/:path*'],
};
