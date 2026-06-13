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
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
