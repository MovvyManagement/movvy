// =============================================================================
// Middleware helper — refreshes the Supabase auth session on every request
// to /admin-management/*. Without this, the session would silently expire
// mid-browse and the next API call would 401.
//
// Lives separately from the main middleware.ts so the @supabase/ssr docs
// pattern is preserved (they recommend isolating the cookie-bridge logic
// because cookie semantics in Next.js middleware are fiddly).
// =============================================================================

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  // Forward the pathname to the server components as a REQUEST header. Layouts
  // can't read the URL themselves, and the admin layout has to know when it's
  // wrapping a public auth page so it renders bare instead of drawing the
  // console shell around "Reset your password". Response headers can't do this
  // — only request headers reach `headers()` in a server component.
  const headers = new Headers(request.headers);
  headers.set('x-movvy-pathname', request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touches the session — refreshing if needed. Returns the user so the
  // caller can decide whether to redirect (auth check happens in
  // middleware.ts at the project root, not here).
  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
