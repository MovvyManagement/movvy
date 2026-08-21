// =============================================================================
// /admin-management/* layout — shared shell for the admin console.
//
// Renders a sidebar with navigation (with active-state highlighting),
// a top bar with signed-in user + sign-out, and the AdminLiveCenter
// for real-time data, toasts, sound, and offline reconnect.
//
// Auth enforced by middleware.ts — by the time children render here,
// we know there's a movvy_admin or movvy_support session.
// =============================================================================

import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { logout } from './login/actions';
import { LoginGate } from './_components/LoginGate';
import { AdminLiveCenter } from './_components/AdminLiveCenter';
import { MobileTopBar, type MobileLink } from './_components/MobileTopBar';

// Sign-in / recovery pages. They render standalone — no sidebar, no counts.
const AUTH_PAGES = [
  '/admin-management/login',
  '/admin-management/forgot-password',
  '/admin-management/reset-password',
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth pages NEVER get the console shell, session or no session. This used to
  // hinge on `!user`, which is wrong for the reset-password flow: redeeming a
  // recovery link creates a session, so the sidebar, nav and live counts drew
  // themselves around "Choose a new password" — console chrome for someone who
  // hasn't finished authenticating. The pathname arrives as a request header
  // from the proxy (server components can't read the URL).
  const pathname = (await headers()).get('x-movvy-pathname') ?? '';
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));
  if (isAuthPage) {
    return <>{children}</>;
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // Login page renders its own minimal layout — LoginGate detects /login
  // and renders children bare instead of inside the admin shell.
  if (!user) {
    return <LoginGate>{children}</LoginGate>;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, role')
    .eq('id', user.id)
    .single();

  // Access tier is resolved in the DB (movvy_admin_access) so blocked employees
  // and non-admins are turned away consistently. null = no access → out.
  const access = await getAdminAccess(supabase);
  if (!access) {
    redirect('/');
  }
  const isManagement = access === 'management';

  // Fetch live counts for sidebar badges
  const [pendingApprovals, openSupport, openDisputes, pendingPayouts, owedRefunds] = await Promise.all([
    supabase
      .from('partner_teams')
      .select('id', { count: 'exact', head: true })
      .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress'])
      .then(async (r) => {
        const companies = await supabase
          .from('companies')
          .select('id', { count: 'exact', head: true })
          .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress']);
        return (r.count ?? 0) + (companies.count ?? 0);
      }),
    supabase
      .from('chat_threads')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'support')
      .gte('last_message_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .then((r) => r.count ?? 0),
    supabase
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_review'])
      .then((r) => r.count ?? 0),
    // Crews waiting on money — the one badge that costs goodwill to ignore.
    supabase
      .from('payout_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then((r) => r.count ?? 0),
    // Customers owed money back. Counted rather than derived in SQL here
    // because the RPC is management-only and this layout also renders for
    // staff — a staff session gets an empty list and therefore no badge,
    // which is correct: they can't action it either.
    supabase
      .rpc('admin_refunds_owed')
      .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
      .then((n) => n, () => 0),
  ]);

  // Flat link list for the mobile drawer (same gating as the sidebar).
  const mobileLinks: MobileLink[] = [
    { href: '/admin-management/dashboard', label: 'Dashboard' },
    { href: '/admin-management/moves', label: 'Moves' },
    { href: '/admin-management/approvals', label: 'Approvals', badge: pendingApprovals || undefined },
    { href: '/admin-management/users', label: 'Users' },
    { href: '/admin-management/support', label: 'Support', badge: openSupport || undefined },
    { href: '/admin-management/disputes', label: 'Disputes', badge: openDisputes || undefined },
    { href: '/admin-management/security', label: 'Security' },
    ...(isManagement
      ? [
          { href: '/admin-management/payouts', label: 'Payouts', badge: pendingPayouts || undefined },
          { href: '/admin-management/crews', label: 'Crews' },
          { href: '/admin-management/refunds', label: 'Refunds', badge: owedRefunds || undefined },
          { href: '/admin-management/revenue', label: 'Revenue' },
          { href: '/admin-management/payments', label: 'Payments' },
          { href: '/admin-management/team', label: 'Team' },
          { href: '/admin-management/settings', label: 'Settings' },
        ]
      : []),
  ];
  const userLabel = profile?.full_name ?? profile?.email ?? 'Admin';

  return (
    <div className="min-h-screen md:flex bg-zinc-50">
      {/* Mobile top bar (hidden on md+) */}
      <MobileTopBar links={mobileLinks} userLabel={userLabel} />

      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-64 bg-white border-r border-zinc-200 flex-col sticky top-0 h-screen">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-zinc-100">
          <Link href="/admin-management/dashboard" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              M
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900 leading-none">Movvy</div>
              <div className="text-xs text-zinc-500 mt-0.5">Operations Console</div>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          <NavSection label="Overview">
            <NavLink href="/admin-management/dashboard" label="Dashboard" icon="dashboard" />
          </NavSection>
          <NavSection label="Operations">
            <NavLink href="/admin-management/moves" label="Moves" icon="moves" />
            <NavLink
              href="/admin-management/approvals"
              label="Approvals"
              icon="approvals"
              badge={pendingApprovals > 0 ? pendingApprovals : undefined}
              badgeTone="warning"
            />
            <NavLink href="/admin-management/users" label="Users" icon="users" />
          </NavSection>
          <NavSection label="Customer">
            <NavLink
              href="/admin-management/support"
              label="Support"
              icon="support"
              badge={openSupport > 0 ? openSupport : undefined}
              badgeTone="info"
            />
            <NavLink
              href="/admin-management/disputes"
              label="Disputes"
              icon="disputes"
              badge={openDisputes > 0 ? openDisputes : undefined}
              badgeTone="warning"
            />
          </NavSection>
          {/* Management-only surfaces — revenue + employee access. Hidden
              entirely from staff (defence in depth; the pages also re-check). */}
          {isManagement ? (
            <NavSection label="Management">
              <NavLink href="/admin-management/revenue" label="Revenue" icon="revenue" />
              <NavLink
                href="/admin-management/payouts"
                label="Payouts"
                icon="revenue"
                badge={pendingPayouts || undefined}
              />
              {/* Sits under Payouts because it answers the other half of the
                  same question: Payouts is what was asked for, Crews is who
                  you'd be paying and where the money goes. */}
              <NavLink href="/admin-management/crews" label="Crews" icon="team" />
              {/* Money owed BACK, as opposed to Payouts' money owed out. */}
              <NavLink
                href="/admin-management/refunds"
                label="Refunds"
                icon="revenue"
                badge={owedRefunds || undefined}
              />
              <NavLink href="/admin-management/payments" label="Payments" icon="revenue" />
              <NavLink href="/admin-management/team" label="Team" icon="team" />
              <NavLink href="/admin-management/settings" label="Settings" icon="settings" />
            </NavSection>
          ) : null}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-zinc-100 space-y-1">
          <Link href="/admin-management/security" className="block px-3 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
            Security · 2FA
          </Link>
          <div className="px-3 py-2 rounded-xl bg-zinc-50">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">
                {(profile?.full_name ?? profile?.email ?? 'A')[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-900 truncate">
                  {profile?.full_name ?? profile?.email ?? 'Admin'}
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {isManagement ? 'Management' : 'Support Agent'}
                </div>
              </div>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-h-screen">
        {children}
      </main>

      {/* Live updates + toasts + sound + reconnect. Single global mount. */}
      <AdminLiveCenter />
    </div>
  );
}

// ── NavSection ────────────────────────────────────────────────────────────────
function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 first:pt-0">
      <div className="px-3 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ── NavLink ───────────────────────────────────────────────────────────────────
// Server component — cannot read pathname, so we use a client wrapper approach.
// For now we highlight by href match via a client boundary component.
function NavLink({
  href,
  label,
  icon,
  badge,
  badgeTone,
}: {
  href: string;
  label: string;
  icon: 'dashboard' | 'approvals' | 'support' | 'moves' | 'revenue' | 'team' | 'users' | 'disputes' | 'settings';
  badge?: number;
  badgeTone?: 'warning' | 'info';
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
    >
      <NavIcon kind={icon} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            badgeTone === 'warning'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-zinc-200 text-zinc-600'
          }`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function NavIcon({ kind }: { kind: 'dashboard' | 'approvals' | 'support' | 'moves' | 'revenue' | 'team' | 'users' | 'disputes' | 'settings' }) {
  const cls = 'h-4 w-4 text-zinc-400 group-hover:text-zinc-600 transition-colors shrink-0';
  if (kind === 'users') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (kind === 'disputes') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (kind === 'settings') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  if (kind === 'revenue') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  }
  if (kind === 'team') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (kind === 'dashboard') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
      </svg>
    );
  }
  if (kind === 'approvals') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
      </svg>
    );
  }
  if (kind === 'support') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
