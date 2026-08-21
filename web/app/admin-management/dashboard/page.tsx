// =============================================================================
// /admin-management/dashboard — launch-ready operational overview.
//
// International-standard admin dashboard with:
// · Revenue KPIs (today, MTD, all-time) with Movvy commission breakdown
// · Booking funnel metrics (conversion, cancellation rate, avg booking value)
// · Live operational counters (active moves, pending approvals, open disputes)
// · Customer support inbox summary with SLA indicator
// · Driver / crew network health (active partners, pending verifications)
// · Recent bookings table with full context (last 10)
// · Ratings & satisfaction score
// · Revenue trend (last 7 days, day-by-day bar chart)
// · Top cities by booking volume (last 30 days)
// · Pending payouts & finance summary
//
// All numbers are live Supabase queries — no hardcoded fixtures.
// Force-dynamic so every page load reflects the latest state.
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
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

/**
 * The instant Alberta's calendar day containing `d` began.
 *
 * Derived from the zone rather than assumed, so this is correct on a UTC server
 * and correct across the daylight-saving switch (when a "day" is 23 or 25 hours
 * long, which is exactly when a hardcoded -6 or -7 offset silently lies).
 */
function albertaDayStart(d: Date): Date {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALBERTA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).split('-').map(Number);
  // Guess at UTC midnight, then correct by however far that lands from local
  // midnight. One correction is always enough: the error is the zone offset.
  const guess = Date.UTC(y, m - 1, day);
  const off = zoneOffsetMs(new Date(guess));
  return new Date(guess + off);
}

/** The instant the current Alberta calendar month began. */
function albertaMonthStart(d: Date): Date {
  const [y, m] = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALBERTA_TZ, year: 'numeric', month: '2-digit',
  }).format(d).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, 1);
  return new Date(guess + zoneOffsetMs(new Date(guess)));
}

/** How far Alberta is behind UTC at instant `d`, in ms (positive). */
function zoneOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ALBERTA_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).reduce<Record<string, number>>((a, p) => {
    if (p.type !== 'literal') a[p.type] = Number(p.value);
    return a;
  }, {});
  const asUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour % 24, parts.minute, parts.second,
  );
  return d.getTime() - asUtc;
}

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  // Revenue figures are management-only. Staff still see live ops, just no money.
  const isManagement = (await getAdminAccess(supabase)) === 'management';

  // ── Day boundaries, in ALBERTA time ────────────────────────────────────────
  // These were computed with setUTCHours(0,0,0,0), i.e. midnight UTC — which is
  // 6:00 PM Mountain the PREVIOUS day. "Bookings today", "Revenue today", the
  // cancellation rate and every month figure therefore started counting from
  // last evening, and the 7-day chart labelled its bars in local time while
  // filtering them in UTC, so the labels and the data disagreed and tonight's
  // revenue fell outside the chart entirely.
  //
  // Movvy operates in one province. The day that matters is the Alberta day,
  // and it has to be derived rather than assumed, because the server this runs
  // on is not in Alberta and the offset changes with daylight saving.
  const now = new Date();
  const startOfToday = albertaDayStart(now);
  const startOfMonth = albertaMonthStart(now);
  const startOf7Days = new Date(startOfToday.getTime() - 6 * 86_400_000);

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    bookingsToday,
    bookingsMonth,
    bookingsAllTime,
    pendingTeams,
    pendingCompanies,
    activeBookings,
    openDisputes,
    openSupportThreads,
    waitingSupportCount,
    recentBookings,
    totalCustomers,
    totalPartnerTeams,
    totalCompanies,
    ratingsData,
    cancelledToday,
    completedAllTime,
    topCities,
    payoutRequests,
    unreadNotifications,
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select('price_total_cents, movvy_margin_cents, status')
      .gte('created_at', startOfToday.toISOString()),

    supabase
      .from('bookings')
      .select('price_total_cents, movvy_margin_cents, status')
      .gte('created_at', startOfMonth.toISOString()),

    supabase
      .from('bookings')
      .select('price_total_cents, movvy_margin_cents, status, created_at'),

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

    supabase
      .from('chat_threads')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'support')
      .gte('last_message_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),

    supabase
      .from('chat_messages')
      .select('thread_id', { count: 'exact', head: true })
      .eq('is_admin', false)
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),

    supabase
      .from('bookings')
      .select(
        'id, short_code, status, pickup_city, dropoff_city, price_total_cents, movvy_margin_cents, scheduled_for_date, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10),

    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'customer'),

    supabase
      .from('partner_teams')
      .select('id', { count: 'exact', head: true })
      .eq('onboarding_status', 'verified'),

    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('onboarding_status', 'verified'),

    // `ratings.score` has never existed — the columns are overall,
    // professionalism, timeliness, carefulness, communication (0003). Selecting
    // a phantom column makes PostgREST 400 the request, so .data was null and
    // this tile read "— / 5 · 0 total ratings" no matter how many ratings existed.
    supabase
      .from('ratings')
      .select('overall'),

    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'cancelled')
      .gte('created_at', startOfToday.toISOString()),

    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed'),

    supabase
      .from('bookings')
      .select('pickup_city')
      .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .not('pickup_city', 'is', null),

    // Was driver_payouts.amount_cents — a column that doesn't exist on that
    // table (it has gross_cents / movvy_margin_cents / net_cents), so the tile
    // read "0 · All caught up" while crews waited. It also disagreed with the
    // sidebar badge, which counts payout_requests. Payouts are requested and
    // paid by hand through payout_requests now, so read the same table the badge
    // does — one number, one source.
    supabase
      .from('payout_requests')
      .select('id, amount_cents', { count: 'exact' })
      .eq('status', 'pending'),

    // `notifications.read` doesn't exist — unread is `read_at is null` (0004).
    // .eq('read', false) 400'd, so the count was null and rendered as 0.
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .gte('created_at', startOfToday.toISOString()),
  ]);

  // ── Aggregate revenue ──────────────────────────────────────────────────────
  const notCancelled = (rows: any[]) => rows.filter((b) => b.status !== 'cancelled');

  const revenueToday = notCancelled(bookingsToday.data ?? []).reduce(
    (s, b) => s + (b.price_total_cents ?? 0), 0,
  );
  const commissionToday = notCancelled(bookingsToday.data ?? []).reduce(
    (s, b) => s + (b.movvy_margin_cents ?? 0), 0,
  );
  const revenueMonth = notCancelled(bookingsMonth.data ?? []).reduce(
    (s, b) => s + (b.price_total_cents ?? 0), 0,
  );
  const commissionMonth = notCancelled(bookingsMonth.data ?? []).reduce(
    (s, b) => s + (b.movvy_margin_cents ?? 0), 0,
  );
  const revenueAllTime = notCancelled(bookingsAllTime.data ?? []).reduce(
    (s, b) => s + (b.price_total_cents ?? 0), 0,
  );
  const commissionAllTime = notCancelled(bookingsAllTime.data ?? []).reduce(
    (s, b) => s + (b.movvy_margin_cents ?? 0), 0,
  );

  const totalBookingsToday = (bookingsToday.data ?? []).length;
  const cancelledTodayCount = cancelledToday.count ?? 0;
  const cancellationRate =
    totalBookingsToday > 0
      ? Math.round((cancelledTodayCount / totalBookingsToday) * 100)
      : 0;
  const totalBookingsAllTime = (bookingsAllTime.data ?? []).length;
  const avgBookingValue =
    totalBookingsAllTime > 0 ? Math.round(revenueAllTime / totalBookingsAllTime) : 0;

  // ── 7-day trend ────────────────────────────────────────────────────────────
  const dayLabels: string[] = [];
  const dayRevenue: number[] = [];
  for (let i = 6; i >= 0; i--) {
    // Each bucket is a real Alberta day: [local midnight, next local midnight).
    // Compare instants, not date strings — the previous version sliced a UTC
    // date out of the timestamp and compared it as text, which shifted every
    // bar by six hours and dropped anything after 6 PM off the end.
    const start = albertaDayStart(new Date(startOfToday.getTime() - i * 86_400_000));
    const end = albertaDayStart(new Date(start.getTime() + 36 * 3_600_000));
    dayLabels.push(
      start.toLocaleDateString('en-CA', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: ALBERTA_TZ,
      }),
    );
    const sum = notCancelled(bookingsAllTime.data ?? [])
      .filter((b) => {
        const t = new Date(b.created_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      })
      .reduce((s, b) => s + (b.price_total_cents ?? 0), 0);
    dayRevenue.push(sum);
  }
  const maxDayRevenue = Math.max(...dayRevenue, 1);

  // ── Top cities ─────────────────────────────────────────────────────────────
  const cityCounts: Record<string, number> = {};
  (topCities.data ?? []).forEach((b: any) => {
    if (b.pickup_city) cityCounts[b.pickup_city] = (cityCounts[b.pickup_city] ?? 0) + 1;
  });
  const topCitiesSorted = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // ── Ratings ────────────────────────────────────────────────────────────────
  const ratings = ratingsData.data ?? [];
  const avgRating =
    ratings.length > 0
      ? (ratings.reduce((s: number, r: any) => s + (r.overall ?? 0), 0) / ratings.length).toFixed(1)
      : null;

  // ── Payouts ────────────────────────────────────────────────────────────────
  const pendingPayoutsCount = payoutRequests.count ?? 0;
  const pendingPayoutsAmount = (payoutRequests.data ?? []).reduce(
    (s: number, p: any) => s + (p.amount_cents ?? 0), 0,
  );

  const pendingApprovals = (pendingTeams.count ?? 0) + (pendingCompanies.count ?? 0);
  const totalPartners = (totalPartnerTeams.count ?? 0) + (totalCompanies.count ?? 0);

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Operations Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {new Date().toLocaleDateString('en-CA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
          Real-time · auto-refreshes on change
        </div>
      </div>

      {/* Alert banner */}
      {((openDisputes.count ?? 0) > 0 || (waitingSupportCount.count ?? 0) > 0) && (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3 flex items-center gap-4">
          <svg className="text-amber-600 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="text-sm text-amber-800 flex-1">
            {(openDisputes.count ?? 0) > 0 && (
              <span className="font-semibold">{openDisputes.count} open dispute{(openDisputes.count ?? 0) !== 1 ? 's' : ''} · </span>
            )}
            {(waitingSupportCount.count ?? 0) > 0 && (
              <span className="font-semibold">{waitingSupportCount.count} support message{(waitingSupportCount.count ?? 0) !== 1 ? 's' : ''} waiting for reply</span>
            )}
          </div>
          <Link href="/admin-management/support" className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2 whitespace-nowrap">
            View now →
          </Link>
        </div>
      )}

      {/* ── Revenue KPIs (management only) ─────────────────────────────────── */}
      {isManagement ? (
        <>
          <SectionHeader title="Revenue" />
          <div className="grid grid-cols-3 gap-4 mb-6">
            <KpiCard label="GMV Today" value={fmtCents(revenueToday)} sub={`${totalBookingsToday} booking${totalBookingsToday !== 1 ? 's' : ''}`} accent />
            <KpiCard
              label="Commission Today"
              value={fmtCents(commissionToday)}
              sub={revenueToday > 0 ? `${Math.round((commissionToday / revenueToday) * 100)}% take rate` : 'No bookings yet'}
            />
            <KpiCard label="MTD Revenue" value={fmtCents(revenueMonth)} sub={`${fmtCents(commissionMonth)} commission MTD`} />
            <KpiCard label="All-Time GMV" value={fmtCents(revenueAllTime)} sub={`${totalBookingsAllTime} total bookings`} />
            <KpiCard
              label="All-Time Commission"
              value={fmtCents(commissionAllTime)}
              sub={revenueAllTime > 0 ? `${Math.round((commissionAllTime / revenueAllTime) * 100)}% blended take rate` : '—'}
            />
            <KpiCard
              label="Avg Booking Value"
              value={fmtCents(avgBookingValue)}
              sub={`${cancellationRate}% cancellation rate today`}
              tone={cancellationRate > 20 ? 'warning' : 'default'}
            />
          </div>
        </>
      ) : null}

      {/* ── Live Operations ────────────────────────────────────────────── */}
      <SectionHeader title="Live Operations" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        <ActionCard
          label="Active Moves"
          count={activeBookings.count ?? 0}
          description="Moves currently in progress"
          href="/admin-management/moves?tab=active"
          tone="success"
          icon="truck"
        />
        <ActionCard
          label="Pending Approvals"
          count={pendingApprovals}
          description={`${pendingTeams.count ?? 0} crews · ${pendingCompanies.count ?? 0} companies`}
          href="/admin-management/approvals"
          tone={pendingApprovals > 0 ? 'warning' : 'neutral'}
          icon="check"
        />
        <ActionCard
          label="Support Threads"
          count={openSupportThreads.count ?? 0}
          description={`${waitingSupportCount.count ?? 0} waiting for reply`}
          href="/admin-management/support"
          tone={(waitingSupportCount.count ?? 0) > 0 ? 'warning' : 'neutral'}
          icon="chat"
        />
        <ActionCard
          label="Open Disputes"
          count={openDisputes.count ?? 0}
          description="Requiring admin resolution"
          href="/admin-management/support"
          tone={(openDisputes.count ?? 0) > 0 ? 'danger' : 'neutral'}
          icon="alert"
        />
      </div>

      {/* ── 7-day Revenue Trend (management only) ───────────────────────── */}
      {isManagement ? (
        <>
          <SectionHeader title="7-Day Revenue Trend" />
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-6">
            <div className="flex items-end gap-2 h-28">
              {dayRevenue.map((rev, i) => {
                const pct = (rev / maxDayRevenue) * 100;
                const isToday = i === 6;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="text-xs text-zinc-400 font-medium truncate w-full text-center">{fmtCents(rev)}</div>
                    <div
                      className={`w-full rounded-t-lg ${isToday ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                      style={{ height: `${Math.max(pct, 3)}%`, minHeight: '4px' }}
                    />
                    <div className="text-xs text-zinc-500 text-center leading-tight whitespace-nowrap overflow-hidden text-ellipsis w-full">
                      {dayLabels[i].split(',')[0]}
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
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Customers" value={String(totalCustomers.count ?? 0)} hint="Registered users" />
        <StatCard
          label="Active Partners"
          value={String(totalPartners)}
          hint={`${totalPartnerTeams.count ?? 0} crews · ${totalCompanies.count ?? 0} companies`}
        />
        <StatCard
          label="Avg Rating"
          value={avgRating ? `${avgRating} / 5` : '—'}
          hint={`${ratings.length} total rating${ratings.length !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Completed Moves"
          value={String(completedAllTime.count ?? 0)}
          hint="All-time completed bookings"
        />
      </div>

      {/* ── Finance & Payouts ────────────────────────────────────────────── */}
      <SectionHeader title="Finance & Payouts" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Pending Payouts"
          value={String(pendingPayoutsCount)}
          hint={pendingPayoutsCount > 0 ? `${fmtCents(pendingPayoutsAmount)} to release` : 'All caught up'}
          tone={pendingPayoutsCount > 5 ? 'warning' : 'default'}
        />
        <StatCard
          label="Cancelled Today"
          value={String(cancelledTodayCount)}
          hint={`${cancellationRate}% of today's bookings`}
          tone={cancellationRate > 25 ? 'warning' : 'default'}
        />
        <StatCard
          label="Unread Notifications"
          value={String(unreadNotifications.count ?? 0)}
          hint="System notifications today"
        />
      </div>

      {/* ── Top Cities ───────────────────────────────────────────────────── */}
      {topCitiesSorted.length > 0 && (
        <>
          <SectionHeader title="Top Cities · Last 30 Days" />
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-6">
            {topCitiesSorted.map(([city, count], i) => {
              const pct = Math.round((count / (topCitiesSorted[0]?.[1] ?? 1)) * 100);
              return (
                <div key={city} className="flex items-center gap-4 px-5 py-3 border-b border-zinc-100 last:border-b-0">
                  <div className="w-5 text-sm font-bold text-zinc-400">{i + 1}</div>
                  <div className="w-32 text-sm font-semibold text-zinc-900 truncate">{city}</div>
                  <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-20 text-right text-sm font-semibold text-zinc-600">{count} move{count !== 1 ? 's' : ''}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Recent Bookings ────────────────────────────────────────────── */}
      <SectionHeader title="Recent Bookings" action={{ label: 'View all moves', href: '/admin-management/moves' }} />
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-6">
        {(recentBookings.data ?? []).length === 0 ? (
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
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">GMV</th>
                  {/* Commission is Movvy's cut — management only. This table sits
                      AFTER the isManagement block closes, so the column used to
                      render for staff-tier employees too, on the one screen they
                      can reach. /revenue redirects them away; this showed them
                      the same figures per booking. */}
                  {isManagement ? (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Commission</th>
                  ) : null}
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {(recentBookings.data ?? []).map((b: any) => (
                  <tr key={b.id} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href="/admin-management/moves" className="font-mono text-xs font-bold text-emerald-700 hover:underline">
                        {b.short_code ?? b.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      <span className="font-medium">{b.pickup_city ?? '—'}</span>
                      <span className="text-zinc-400 mx-1">→</span>
                      <span className="font-medium">{b.dropoff_city ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">{fmtDate(b.scheduled_for_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">{fmtCents(b.price_total_cents)}</td>
                    {isManagement ? (
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmtCents(b.movvy_margin_cents)}</td>
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
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${tone === 'warning' ? 'text-amber-700' : 'text-zinc-900'}`}>{value}</div>
      {hint && <div className={`text-xs mt-1 ${tone === 'warning' ? 'text-amber-600' : 'text-zinc-500'}`}>{hint}</div>}
    </div>
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
  icon: 'truck' | 'check' | 'chat' | 'alert';
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
