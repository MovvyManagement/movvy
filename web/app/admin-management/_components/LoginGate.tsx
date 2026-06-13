// =============================================================================
// LoginGate — thin client wrapper used by the admin layout to render
// /admin-management/login WITHOUT the sidebar shell. Server components
// can't read the current pathname, so we read it here on the client
// and render children bare when the path matches /login.
//
// Anywhere else under /admin-management/* (the auth-gated routes), the
// middleware should have already redirected unauthenticated users to
// /login, so the layout's `if (!user)` branch shouldn't render this
// for those routes in practice.
// =============================================================================

'use client';

import { usePathname } from 'next/navigation';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin-management/login')) {
    return <>{children}</>;
  }
  // Defensive fallback for any other unauthenticated state — render
  // children bare so we don't crash on `if (!user)` while waiting for
  // the middleware redirect to land.
  return <>{children}</>;
}
