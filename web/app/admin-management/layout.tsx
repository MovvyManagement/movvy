// =============================================================================
// /admin-management/* layout — shared shell for every page inside the
// admin console. Renders a sidebar with navigation and a top bar with
// the signed-in user + sign-out button. The login page lives at
// /admin-management/login and renders WITHOUT this layout (Next.js
// route groups would be cleaner, but for one exception the conditional
// is simpler).
//
// Auth is enforced by middleware.ts at the request layer — by the time
// children render here, we already know there's a movvy_admin or
// movvy_support session. We re-fetch the profile to put the name in
// the header, which is cheap and avoids JWT staleness.
// =============================================================================

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { logout } from './login/actions';
import { LoginGate } from './_components/LoginGate';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // The login page renders its own minimal layout (no sidebar). LoginGate
  // is a tiny client wrapper that detects the /login route and renders
  // children bare instead of inside the admin shell.
  if (!user) {
    return <LoginGate>{children}</LoginGate>;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, role')
    .eq('id', user.id)
    .single();

  // Defensive — middleware should have caught this, but if a non-admin
  // somehow reaches the layout, kick them to the public site.
  if (!profile || !['movvy_admin', 'movvy_support'].includes(profile.role)) {
    redirect('/');
  }

  return (
    <div className="min-h-screen flex bg-zinc-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-zinc-200 flex flex-col">
        <div className="px-6 py-5 border-b border-zinc-200">
          <Link href="/admin-management/dashboard" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
              M
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900">Movvy</div>
              <div className="text-xs text-zinc-500 -mt-0.5">Operations</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink href="/admin-management/dashboard" label="Dashboard" icon="dashboard" />
          <NavLink href="/admin-management/approvals" label="Approvals" icon="approvals" />
          <NavLink href="/admin-management/support" label="Support" icon="support" />
          <NavLink href="/admin-management/moves" label="Moves" icon="moves" />
        </nav>

        <div className="px-3 py-4 border-t border-zinc-200">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-semibold text-zinc-900 truncate">
              {profile.full_name ?? profile.email ?? 'Admin'}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {profile.role === 'movvy_admin' ? 'Administrator' : 'Support agent'}
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: 'dashboard' | 'approvals' | 'support' | 'moves';
}) {
  // No active-state highlighting yet — that needs a client component
  // to read usePathname(). Skipping for v1 to keep the layout as a
  // pure server component (faster + less JS shipped).
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
    >
      <NavIcon kind={icon} />
      {label}
    </Link>
  );
}

function NavIcon({ kind }: { kind: 'dashboard' | 'approvals' | 'support' | 'moves' }) {
  const common = 'h-5 w-5 text-zinc-400';
  if (kind === 'dashboard') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    );
  }
  if (kind === 'approvals') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    );
  }
  if (kind === 'support') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  }
  // moves
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
