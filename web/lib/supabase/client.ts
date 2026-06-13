// =============================================================================
// Browser-side Supabase client — used in Client Components (the support
// chat panel, anything that needs Supabase Realtime, sign-out buttons, etc).
//
// Same anon key as the server client. Real-time subscriptions are the main
// reason this exists at all — Server Components can't hold a websocket.
// =============================================================================

'use client';

import { createBrowserClient } from '@supabase/ssr';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  // Singleton — repeated calls return the same client so realtime
  // subscriptions share one socket connection.
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
