// =============================================================================
// /admin-management/dashboard — operational overview.
//
// Shows in one screen:
//   · Revenue today + Movvy commission today
//   · This-month totals
//   · Pending approvals count (with deep-link)
//   · Active moves count (in-progress statuses)
//   · Open support threads
//   · Recent bookings table (last 10)
//
// All numbers are live Supabase queries — no hardcoded fixtures. RLS
// allows movvy_admin / movvy_support to read these tables; the queries
// use the user-scoped client so the same checks apply that the rest
// of the app uses.
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtCents, fmtRelative, fmtStatus } from '@/lib/format';
import { RealtimeRefresh } from '../_components/RealtimeRefresh';

// In-progress statuses (booking_status enum). Mirrors the mover-app's
// ACTIVE_STATUSES set so the count matches what drivers see.
const ACTIVE_STATUSES = [
  'assigned',
  'confirmed',
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
];

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setUTCDate(1);

  // Parallel fetch — Promise.all keeps the dashboard snappy. Each query
  // is small and targets a single indexed column.
  const [
    bookingsToday,
    bookingsMonth,
    pendingTeams,
    pendingCompanies,
    activeBookings,
    openDisputes,
    openSupportThreads,
    recentBookings,
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select('price_total_cents, movvy_margin_cents')
      .gte('created_at', startOfToday.toISOString()),
    supabase
      .from('bookings')
      .select('price_total_cents, movvy_margin_cents')
      .gte('created_at', startOfMonth.toISOString()),
    supabase
      .from('partner_teams')
      .select('id', { count: 'exact', head: true })
      .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress']),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress']),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_STATUSES),
    supabase
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_review']),
    // Count support threads with activity in the last 7 days — proxy
    // for "open" since this schema doesn't store an explicit closed flag.
    supabase
      .from('chat_threads')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'support')
      .gte('last_message_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    supabase
      .from('bookings')
      .select(
        'id, short_code, status, pickup_city, dropoff_city, price_total_cents, movvy_margin_cents, scheduled_for_date, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const revenueToday = (bookingsToday.data ?? []).reduce(
    (s, b) => s + (b.price_total_cents ?? 0),
    0,
  );
  const commissionToday = (bookingsToday.data ?? []).reduce(
    (s, b) => s + (b.movvy_margin_cents ?? 0),
    0,
  );
  const revenueMonth = (bookingsMonth.data ?? []).reduce(
    (s, b) => s + (b.price_total_cents ?? 0),
    0,
  );
  const commissionMonth = (bookingsMonth.data ?? []).reduce(
    (s, b) => s + (b.movvy_margin_cents ?? 0),
    0,
  );

  const pendingCount = (pendingTeams.count ?? 0) + (pendingCompanies.count ?? 0);

  return (
    <div className="px-8 py-8">
      {/* Subscribes to every table the dashboard reads. Any insert/update
          on any of these triggers a server re-render in the background —
          no full page reload, no manual refresh. */}
      <RealtimeRefresh
        channel="admin-dashboard"
        tables={[
          'bookings',
          'chat_threads',
          'disputes',
          'partner_teams',
          'companies',
        ]}
      />

      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Live snapshot of Movvy operations. Updates in real-time.
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Revenue today"
          value={fmtCents(revenueToday)}
          hint={`${bookingsToday.data?.length ?? 0} bookings`}
        />
        <StatCard
          label="Movvy commission today"
          value={fmtCents(commissionToday)}
          hint={`Take rate ${
            revenueToday ? Math.round((commissionToday / revenueToday) * 100) : 0
          }%`}
          accent
        />
        <StatCard
          label="Revenue this month"
          value={fmtCents(revenueMonth)}
          hint={`${bookingsMonth.data?.length ?? 0} bookings`}
        />
        <StatCard
          label="Commission this month"
          value={fmtCents(commissionMonth)}
          hint="What Movvy keeps"
          accent
        />
      </div>

      {/* Action queue row */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <ActionCard
          label="Pending approvals"
          count={pendingCount}
          tone={pendingCount > 0 ? 'warning' : 'neutral'}
          href="/admin-management/approvals"
          description={
            pendingCount > 0
              ? `${pendingTeams.count ?? 0} teams · ${pendingCompanies.count ?? 0} companies waiting`
              : 'All clear — no applicants waiting'
          }
        />
        <ActionCard
          label="Active moves"
          count={activeBookings.count ?? 0}
          tone="success"
          href="/admin-management/moves"
          description="In-progress moves right now"
        />
        <ActionCard
          label="Open support chats"
          count={openSupportThreads.count ?? 0}
          tone={(openSupportThreads.count ?? 0) > 0 ? 'warning' : 'neutral'}
          href="/admin-management/support"
          description={
            (openDisputes.count ?? 0) > 0
              ? `Plus ${openDisputes.count} open dispute${openDisputes.count === 1 ? '' : 's'}`
              : 'No open disputes'
          }
        />
      </div>

      {/* Recent bookings */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Recent bookings
        </h2>
        <Link
          href="/admin-management/moves"
          className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          See all moves →
        </Link>
      </div>

      <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
        {(recentBookings.data ?? []).length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-zinc-500">
            No bookings yet.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Code
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Route
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Total
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Commission
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.data?.map((b: any) => (
                <tr key={b.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-5 py-3 text-sm font-bold text-zinc-900">#{b.short_code}</td>
                  <td className="px-5 py-3 text-sm text-zinc-600">
                    {b.pickup_city} → {b.dropoff_city ?? 'in-home'}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-zinc-900 text-right">
                    {fmtCents(b.price_total_cents)}
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-emerald-700 text-right">
                    {fmtCents(b.movvy_margin_cents)}
                  </td>
                  <td className="px-5 py-3 text-sm text-zinc-500 text-right">
                    {fmtRelative(b.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 border ${
        accent
          ? 'bg-emerald-50 border-emerald-100'
          : 'bg-white border-zinc-200'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-2 ${accent ? 'text-emerald-900' : 'text-zinc-900'}`}>
        {value}
      </div>
      {hint ? (
        <div className="text-xs text-zinc-500 mt-1">{hint}</div>
      ) : null}
    </div>
  );
}

function ActionCard({
  label,
  count,
  tone,
  href,
  description,
}: {
  label: string;
  count: number;
  tone: 'success' | 'warning' | 'neutral';
  href: string;
  description: string;
}) {
  const toneClasses = {
    success: 'bg-emerald-600 text-white',
    warning: 'bg-amber-500 text-white',
    neutral: 'bg-zinc-200 text-zinc-700',
  }[tone];
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white border border-zinc-200 p-5 hover:border-zinc-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-zinc-900">{label}</div>
        <div
          className={`min-w-[28px] h-7 px-2 rounded-full flex items-center justify-center text-xs font-bold ${toneClasses}`}
        >
          {count}
        </div>
      </div>
      <div className="text-xs text-zinc-500 mt-2">{description}</div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'bg-zinc-100 text-zinc-700'
      : status === 'cancelled'
      ? 'bg-red-50 text-red-700'
      : ACTIVE_STATUSES.includes(status)
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-amber-50 text-amber-700';
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${tone}`}>
      {fmtStatus(status)}
    </span>
  );
}
