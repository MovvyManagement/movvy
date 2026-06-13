// =============================================================================
// Server-side Supabase client — used in Server Components, Route Handlers,
// and Server Actions. Reads + writes auth cookies via Next.js's cookies()
// API so the user's session survives across requests.
//
// IMPORTANT: this client uses the public anon key, but it reads the user
// JWT from cookies before each query, so RLS still enforces row-level
// access exactly as it does in the mobile app. Server Components never
// see the service-role key — that lives only in edge functions.
// =============================================================================

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component contexts can't set cookies — that's fine,
            // middleware refreshes the session before the request reaches
            // here, so this only catches the no-op edge case.
          }
        },
      },
    },
  );
}
