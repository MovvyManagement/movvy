// =============================================================================
// /admin-management/dashboard — operational overview.
//
// Every number comes from ONE database call, admin_dashboard_stats()
// (migration 0124). The page used to make 22 separate requests, and three of
// them downloaded every booking row to total them here; PostgREST caps a
// response at 1,000 rows, so past 1,000 bookings the all-time figures would
// have silently stopped growing. The database now does the adding up, in
// Alberta days, and the page only lays it out.
//
// If that call fails the page says so instead of showing zeros. Several tiles
// here once read 0 for months because a query broke and nothing noticed.
//
// Money is management-only: the function returns it null for staff, and the
// page hides those sections as well.
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtCents, fmtRelative, fmtStatus, fmtDate } from '@/lib/format';

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

const ALBERTA_TZ = 'America/Edmonton';

type BookingRef = { id: string; short_code: string };

type DashboardStats = {
  access: 'management' | 'staff';
  today: string;
  money: null | {
    gmv_today: number;
    commission_today: number;
    gmv_month: number;
    commission_month: number;
    gmv_all: number;
    commission_all: number;
    avg_booking_cents: number;
    trend: { day: string; cents: number }[];
  };
  bookings_today: number;
  booked_all: number;
  completed_all: number;
  cancelled_today: number;
  cancel_rate_30d: number;
  active_moves: number;
  moves_today: number;
  searching: number;
  pending_crews: number;
  pending_companies: number;
  verified_crews: number;
  verified_companies: number;
  customers: number;
  open_disputes: number;
  support_threads_7d: number;
  support_waiting: number;
  rating_avg: number | null;
  rating_count: number;
  top_cities: { city: string; moves: number }[];
  payouts_pending: number;
  payouts_pending_cents: number | null;
  deposits_owed: BookingRef[];
  deposits_owed_cents: number | null;
  stale_accepted: BookingRef[];
  payments_live: boolean;
  recent: {
    id: string;
    short_code: string | null;
    status: string;
    pickup_city: string | null;
    dropoff_city: string | null;
    scheduled_for_date: string | null;
    created_at: string;
    value_cents: number | null;
    commission_cents: number | null;
  }[];
};

/** "2026-11-16" → "Mon". The day is already an Alberta date, so read it as one. */
const weekday = (isoDay: string) =>
  new Date(`${isoDay}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export default async function DashboardPage() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('admin_dashboard_stats');

  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: ALBERTA_TZ,
  });

  if (error || !data) {
    return (
      <div className="px-4 py-6 sm:px-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-bold text-zinc-900">Operations Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{todayLabel}</p>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <div className="font-semibold">The dashboard numbers didn&apos;t load.</div>
          <div className="mt-1 text-red-700">
            {error?.message ?? 'No data came back.'} Refresh to try again. Nothing is wrong with
            your bookings; only this summary failed.
          </div>
        </div>
      </div>
    );
  }

  const d = data as DashboardStats;
  const isManagement = d.access === 'management';
  const money = isManagement ? d.money : null;

  const pendingApprovals = d.pending_crews + d.pending_companies;
  const activePartners = d.verified_crews + d.verified_companies;
  const trend = money?.trend ?? [];
  const maxDay = Math.max(...trend.map((t) => t.cents), 1);
  const topCityMax = d.top_cities[0]?.moves ?? 1;

  return (
    <div className="px-4 py-6 sm:px-6 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Operations Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
          Live · refreshes when something changes
        </div>
      </div>

      {/* ── Red flags ─────────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <RedFlagIcon />
          <h2 className="text-sm font-bold uppercase tracking-wider text-red-800">Red flags</h2>
          <span className="text-xs text-red-700">· fix before taking real payments</span>
        </div>
        <p className="mt-1 text-xs text-red-700">
          {d.payments_live
            ? 'Payments are LIVE, so real customers are affected by these.'
            : 'Payments are in Stripe test mode, so no real money is affected yet.'}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <RedFlag
            title="Unrefunded deposits"
            body="When the hourly job closes a request nobody accepted, the customer's deposit is not refunded automatically. Each one waits in Refunds, one click per move, back to the card they paid with."
            affected={d.deposits_owed}
            affectedNote={
              d.deposits_owed.length > 0 && d.deposits_owed_cents != null
                ? `${fmtCents(d.deposits_owed_cents)} in deposits still held`
                : d.deposits_owed.length > 0
                ? 'Cancelled moves still holding a deposit'
                : undefined
            }
            action={
              d.deposits_owed.length > 0 && isManagement
                ? { label: 'Refund them', href: '/admin-management/refunds' }
                : undefined
            }
          />
          <RedFlag
            title="Accepted jobs never close"
            body="A job a crew accepted but never started is not closed automatically when its date passes. It stays open in the crew's Scheduled list and the customer's app until someone cancels it from the move page."
            affected={d.stale_accepted}
            affectedNote={d.stale_accepted.length > 0 ? 'Past their move date and still open' : undefined}
          />
        </div>
      </div>

      {/* Alert banner */}
      {(d.open_disputes > 0 || d.support_waiting > 0) && (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 sm:px-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <svg className="text-amber-600 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="text-sm text-amber-800 flex-1 font-semibold">
            {[
              d.open_disputes > 0 ? `${plural(d.open_disputes, 'open dispute')}` : null,
              d.support_waiting > 0 ? `${plural(d.support_waiting, 'support chat')} waiting for a reply` : null,
            ].filter(Boolean).join(' · ')}
          </div>
          <Link
            href={d.support_waiting > 0 ? '/admin-management/support' : '/admin-management/disputes'}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2 whitespace-nowrap"
          >
            View now →
          </Link>
        </div>
      )}

      {/* ── Revenue KPIs (management only) ─────────────────────────────────── */}
      {money ? (
        <>
          <SectionHeader title="Revenue" action={{ label: 'Revenue details', href: '/admin-management/revenue' }} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Booked Today" value={fmtCents(money.gmv_today)} sub={plural(d.bookings_today, 'booking')} accent />
            <KpiCard
              label="Commission Today"
              value={fmtCents(money.commission_today)}
              sub={money.gmv_today > 0 ? `${Math.round((money.commission_today / money.gmv_today) * 100)}% take rate` : 'No bookings yet today'}
            />
            <KpiCard label="This Month" value={fmtCents(money.gmv_month)} sub={`${fmtCents(money.commission_month)} commission`} />
            <KpiCard label="All-Time Booked" value={fmtCents(money.gmv_all)} sub={plural(d.booked_all, 'booking')} />
            <KpiCard
              label="All-Time Commission"
              value={fmtCents(money.commission_all)}
              sub={money.gmv_all > 0 ? `${Math.round((money.commission_all / money.gmv_all) * 100)}% blended take rate` : '—'}
            />
            <KpiCard
              label="Avg Booking Value"
              value={fmtCents(money.avg_booking_cents)}
              sub={`${d.cancel_rate_30d}% of bookings cancelled (30 days)`}
              tone={d.cancel_rate_30d > 20 ? 'warning' : 'default'}
            />
          </div>
          <p className="-mt-4 mb-6 text-xs text-zinc-400">
            Booked value counts paid bookings only, not abandoned checkouts or cancellations.
            Finished moves count at what they actually billed.
          </p>
        </>
      ) : null}

      {/* ── Live Operations ────────────────────────────────────────────── */}
      <SectionHeader title="Live Operations" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <ActionCard
          label="Active Moves"
          count={d.active_moves}
          description="Crew assigned or on the job"
          href="/admin-management/moves?tab=active"
          tone={d.active_moves > 0 ? 'success' : 'neutral'}
          icon="truck"
        />
        <ActionCard
          label="Moves Today"
          count={d.moves_today}
          description={d.searching > 0 ? `${d.searching} still looking for a crew` : 'Scheduled for today'}
          href="/admin-management/moves?tab=today"
          tone={d.searching > 0 ? 'warning' : d.moves_today > 0 ? 'success' : 'neutral'}
          icon="calendar"
        />
        <ActionCard
          label="Pending Approvals"
          count={pendingApprovals}
          description={`${plural(d.pending_crews, 'crew')} · ${plural(d.pending_companies, 'company', 'companies')}`}
          href="/admin-management/approvals"
          tone={pendingApprovals > 0 ? 'warning' : 'neutral'}
          icon="check"
        />
        <ActionCard
          label="Support Waiting"
          count={d.support_waiting}
          description={`${plural(d.support_threads_7d, 'chat')} active this week`}
          href="/admin-management/support"
          tone={d.support_waiting > 0 ? 'warning' : 'neutral'}
          icon="chat"
        />
        <ActionCard
          label="Open Disputes"
          count={d.open_disputes}
          description="Need an admin decision"
          href="/admin-management/disputes"
          tone={d.open_disputes > 0 ? 'danger' : 'neutral'}
          icon="alert"
        />
      </div>

      {/* ── 7-day Revenue Trend (management only) ───────────────────────── */}
      {money ? (
        <>
          <SectionHeader title="Booked, Last 7 Days" />
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 mb-6">
            <div className="flex items-end gap-1.5 sm:gap-2 h-28">
              {trend.map((t, i) => {
                const pct = (t.cents / maxDay) * 100;
                const isToday = i === trend.length - 1;
                return (
                  <div key={t.day} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end">
                    <div className="text-[10px] sm:text-xs text-zinc-400 font-medium truncate w-full text-center">
                      {t.cents > 0 ? fmtCents(t.cents) : ''}
                    </div>
                    <div
                      className={`w-full rounded-t-lg ${isToday ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                      style={{ height: `${Math.max(pct, 3)}%`, minHeight: '4px' }}
                      title={`${fmtDate(t.day)}: ${fmtCents(t.cents)}`}
                    />
                    <div className="text-xs text-zinc-500 text-center leading-tight w-full truncate">
                      {isToday ? 'Today' : weekday(t.day)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* ── Network Health ───────────────────────────────────────────────── */}
      <SectionHeader title="Network Health" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Customers" value={String(d.customers)} hint="Registered accounts" />
        <StatCard
          label="Active Partners"
          value={String(activePartners)}
          hint={`${plural(d.verified_crews, 'crew')} · ${plural(d.verified_companies, 'company', 'companies')}`}
        />
        <StatCard
          label="Avg Rating"
          value={d.rating_avg != null ? `${Number(d.rating_avg).toFixed(1)} / 5` : '—'}
          hint={plural(d.rating_count, 'rating')}
        />
        <StatCard label="Completed Moves" value={String(d.completed_all)} hint="All time" />
      </div>

      {/* ── Finance & Payouts ────────────────────────────────────────────── */}
      <SectionHeader title="Finance & Payouts" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Pending Payouts"
          value={String(d.payouts_pending)}
          hint={
            d.payouts_pending === 0
              ? 'All caught up'
              : d.payouts_pending_cents != null
              ? `${fmtCents(d.payouts_pending_cents)} to release`
              : 'Crews waiting to be paid'
          }
          tone={d.payouts_pending > 5 ? 'warning' : 'default'}
          href={isManagement ? '/admin-management/payouts' : undefined}
        />
        <StatCard
          label="Refunds Owed"
          value={String(d.deposits_owed.length)}
          hint={
            d.deposits_owed.length === 0
              ? 'Nothing held'
              : d.deposits_owed_cents != null
              ? `${fmtCents(d.deposits_owed_cents)} to send back`
              : 'Deposits on cancelled moves'
          }
          tone={d.deposits_owed.length > 0 ? 'warning' : 'default'}
          href={isManagement ? '/admin-management/refunds' : undefined}
        />
        <StatCard
          label="Cancelled Today"
          value={String(d.cancelled_today)}
          hint={`${d.cancel_rate_30d}% of bookings in the last 30 days`}
          tone={d.cancel_rate_30d > 25 ? 'warning' : 'default'}
        />
      </div>

      {/* ── Top Cities ───────────────────────────────────────────────────── */}
      {d.top_cities.length > 0 && (
        <>
          <SectionHeader title="Top Cities · Last 30 Days" />
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-6">
            {d.top_cities.map(({ city, moves }, i) => (
              <div key={city} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 border-b border-zinc-100 last:border-b-0">
                <div className="w-5 text-sm font-bold text-zinc-400">{i + 1}</div>
                <div className="w-24 sm:w-32 text-sm font-semibold text-zinc-900 truncate">{city}</div>
                <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.round((moves / topCityMax) * 100)}%` }} />
                </div>
                <div className="w-20 text-right text-sm font-semibold text-zinc-600">{plural(moves, 'move')}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Recent Bookings ────────────────────────────────────────────── */}
      <SectionHeader title="Recent Bookings" action={{ label: 'View all moves', href: '/admin-management/moves' }} />
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-6">
        {d.recent.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500">No bookings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Booking</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Route</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Value</th>
                  {/* Commission is Movvy's cut — management only. */}
                  {isManagement ? (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Commission</th>
                  ) : null}
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin-management/moves/${b.id}`} className="font-mono text-xs font-bold text-emerald-700 hover:underline">
                        {b.short_code ?? b.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                      <span className="font-medium">{b.pickup_city ?? '—'}</span>
                      <span className="text-zinc-400 mx-1">→</span>
                      <span className="font-medium">{b.dropoff_city ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(b.scheduled_for_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">{fmtCents(b.value_cents)}</td>
                    {isManagement ? (
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmtCents(b.commission_cents)}</td>
                    ) : null}
                    <td className="px-4 py-3 text-right text-zinc-400 whitespace-nowrap text-xs">{fmtRelative(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RedFlagIcon() {
  return (
    <svg className="text-red-600 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 22V4" /><path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

/** One known gap, and the bookings it is affecting right now. */
function RedFlag({
  title,
  body,
  affected,
  affectedNote,
  action,
}: {
  title: string;
  body: string;
  affected: { id: string; short_code: string }[];
  affectedNote?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-bold text-red-800">{title}</div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
            affected.length > 0 ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'
          }`}
          title="Bookings affected right now"
        >
          {affected.length}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-700">{body}</p>
      {affected.length > 0 ? (
        <div className="mt-3">
          {affectedNote ? <div className="text-xs font-semibold text-red-700">{affectedNote}</div> : null}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {affected.slice(0, 12).map((b) => (
              <Link
                key={b.id}
                href={`/admin-management/moves/${b.id}`}
                className="rounded-md bg-red-50 px-2 py-0.5 font-mono text-xs font-semibold text-red-800 hover:bg-red-100"
              >
                #{b.short_code}
              </Link>
            ))}
            {affected.length > 12 ? (
              <span className="px-1 text-xs text-zinc-500">+{affected.length - 12} more</span>
            ) : null}
          </div>
          {action ? (
            <Link href={action.href} className="mt-2 inline-block text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900">
              {action.label} →
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-xs text-zinc-500">No bookings affected right now. The gap is still open.</div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {action && (
        <Link href={action.href} className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'default' | 'warning';
}) {
  const bg = accent ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-zinc-200';
  const valueColor = tone === 'warning' ? 'text-amber-700' : accent ? 'text-emerald-900' : 'text-zinc-900';
  return (
    <div className={`rounded-2xl p-5 border ${bg}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
  href?: string;
}) {
  const body = (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${tone === 'warning' ? 'text-amber-700' : 'text-zinc-900'}`}>{value}</div>
      {hint && <div className={`text-xs mt-1 ${tone === 'warning' ? 'text-amber-600' : 'text-zinc-500'}`}>{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl bg-white border border-zinc-200 p-5 hover:border-zinc-300 hover:shadow-sm transition-all">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl bg-white border border-zinc-200 p-5">{body}</div>
  );
}

function ActionCard({
  label,
  count,
  tone,
  href,
  description,
  icon,
}: {
  label: string;
  count: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  href: string;
  description: string;
  icon: 'truck' | 'check' | 'chat' | 'alert' | 'calendar';
}) {
  const badgeClasses = {
    success: 'bg-emerald-600 text-white',
    warning: 'bg-amber-500 text-white',
    danger: 'bg-red-600 text-white',
    neutral: 'bg-zinc-200 text-zinc-700',
  }[tone];

  const iconEl =
    icon === 'truck' ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ) : icon === 'check' ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
      </svg>
    ) : icon === 'calendar' ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ) : icon === 'chat' ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );

  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white border border-zinc-200 p-5 hover:border-zinc-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-zinc-400">{iconEl}</div>
        <div className={`min-w-[28px] h-7 px-2 rounded-full flex items-center justify-center text-xs font-bold ${badgeClasses}`}>
          {count}
        </div>
      </div>
      <div className="text-sm font-bold text-zinc-900">{label}</div>
      <div className="text-xs text-zinc-500 mt-1">{description}</div>
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
