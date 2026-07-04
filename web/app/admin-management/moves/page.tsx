// =============================================================================
// /admin-management/moves — operational moves view.
//
// Enhancements over v1:
// · Revenue summary bar at top of each tab (GMV + commission for the set)
// · Customer name shown inline (batch lookup)
// · Distance & duration shown where available
// · Estimated vs actual revenue comparison for completed moves
// · Scheduled time window shown
// · Tab counts show revenue totals in tooltips
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtDate, fmtStatus, fmtRelative, fmtDistance, fmtDuration } from '@/lib/format';

const ACTIVE_STATUSES = [
  'assigned',
  'confirmed',
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
];

type Tab = 'active' | 'today' | 'upcoming';

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string; q?: string }>;
}

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function MovesPage({ searchParams }: PageProps) {
  const { tab, page: pageParam, q } = await searchParams;
  const activeTab: Tab = (tab as Tab) || 'active';
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  const search = (q ?? '').trim();

  const supabase = await supabaseServer();

  // Revenue figures on this ops page are management-only. Staff see the moves
  // (routes, status, crew, timing) but no dollar amounts.
  const isManagement = (await getAdminAccess(supabase)) === 'management';

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const sevenDays = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const baseSelect =
    'id, short_code, status, pickup_city, pickup_line1, dropoff_city, dropoff_line1, scheduled_for_date, scheduled_for_window, price_total_cents, movvy_margin_cents, created_at, distance_km, duration_min, customer_id, assigned_team_id, assigned_company_id, actual_total_cents, actual_driver_payout_cents, actual_commission_cents, actual_hours';

  const from = (page - 1) * PAGE_SIZE;
  let query = supabase.from('bookings').select(baseSelect, { count: 'exact' });
  if (search) {
    // Short-code lookup across ALL statuses — the console's booking search.
    const safe = search.replace(/[,()*%]/g, ' ').toUpperCase();
    query = query.ilike('short_code', `%${safe}%`).order('created_at', { ascending: false });
  } else if (activeTab === 'active') {
    query = query.in('status', ACTIVE_STATUSES).order('scheduled_for_date');
  } else if (activeTab === 'today') {
    query = query.eq('scheduled_for_date', todayIso).order('scheduled_for_window');
  } else {
    query = query
      .gte('scheduled_for_date', todayIso)
      .lte('scheduled_for_date', sevenDays)
      .order('scheduled_for_date');
  }
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data: bookings, count: resultCount } = await query;
  const totalPages = Math.max(1, Math.ceil((resultCount ?? 0) / PAGE_SIZE));

  // Tab counts
  const [activeCount, todayCount, upcomingCount] = await Promise.all([
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_STATUSES),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_for_date', todayIso),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_for_date', todayIso)
      .lte('scheduled_for_date', sevenDays),
  ]);

  // Batch-resolve customer / crew names
  const customerIds = [...new Set((bookings ?? []).map((b: any) => b.customer_id).filter(Boolean))];
  const teamIds = [...new Set((bookings ?? []).map((b: any) => b.assigned_team_id).filter(Boolean))];
  const companyIds = [...new Set((bookings ?? []).map((b: any) => b.assigned_company_id).filter(Boolean))];

  const [{ data: customers }, { data: teams }, { data: companies }] = await Promise.all([
    customerIds.length
      ? supabase.from('profiles').select('id, full_name, email, phone').in('id', customerIds)
      : Promise.resolve({ data: [] as any[] }),
    teamIds.length
      ? supabase.from('partner_teams').select('id, display_name').in('id', teamIds)
      : Promise.resolve({ data: [] as any[] }),
    companyIds.length
      ? supabase.from('companies').select('id, display_name').in('id', companyIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const customerMap = new Map((customers ?? []).map((c: any) => [c.id, c]));
  const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t]));
  const companyMap = new Map((companies ?? []).map((c: any) => [c.id, c]));

  // Revenue summary for current tab
  const tabGMV = (bookings ?? []).reduce((s, b: any) => s + (b.price_total_cents ?? 0), 0);
  const tabCommission = (bookings ?? []).reduce((s, b: any) => s + (b.movvy_margin_cents ?? 0), 0);

  return (
    <div className="px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Moves</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {search ? `${resultCount ?? 0} match “${search}”` : `${resultCount ?? 0} moves · updates live`}
          </p>
        </div>
        {/* Booking search by short code */}
        <form className="flex gap-2">
          <input name="q" defaultValue={search} placeholder="Search #code…" className="rounded-lg border border-zinc-300 py-1.5 px-3 text-sm outline-none focus:border-emerald-500 w-40" />
          <button className="rounded-lg bg-zinc-900 text-white text-sm font-semibold px-3 hover:bg-zinc-800">Find</button>
          {search ? <Link href="/admin-management/moves" className="text-sm text-zinc-500 self-center px-1">Clear</Link> : null}
        </form>
      </div>

      {/* Tab bar (hidden during a search — search spans all statuses) */}
      {!search ? (
        <div className="flex items-center gap-1 bg-zinc-100 rounded-2xl p-1 w-fit mb-4">
          <TabLink tab="active" active={activeTab === 'active'} label="Active" count={activeCount.count ?? 0} />
          <TabLink tab="today" active={activeTab === 'today'} label="Today" count={todayCount.count ?? 0} />
          <TabLink tab="upcoming" active={activeTab === 'upcoming'} label="Upcoming" count={upcomingCount.count ?? 0} />
        </div>
      ) : null}

      {/* Revenue summary bar — management only */}
      {isManagement && (bookings ?? []).length > 0 && (
        <div className="flex items-center gap-6 px-5 py-3 bg-white border border-zinc-200 rounded-2xl mb-4">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">GMV</div>
            <div className="text-lg font-bold text-zinc-900 mt-0.5">{fmtCents(tabGMV)}</div>
          </div>
          <div className="w-px h-8 bg-zinc-200" />
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Commission</div>
            <div className="text-lg font-bold text-emerald-700 mt-0.5">{fmtCents(tabCommission)}</div>
          </div>
          <div className="w-px h-8 bg-zinc-200" />
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Avg Value</div>
            <div className="text-lg font-bold text-zinc-900 mt-0.5">
              {fmtCents(Math.round(tabGMV / Math.max((bookings ?? []).length, 1)))}
            </div>
          </div>
          {tabGMV > 0 && (
            <>
              <div className="w-px h-8 bg-zinc-200" />
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Take Rate</div>
                <div className="text-lg font-bold text-zinc-900 mt-0.5">
                  {Math.round((tabCommission / tabGMV) * 100)}%
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bookings list */}
      {(bookings ?? []).length === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-10 text-center">
          <p className="text-sm text-zinc-500">No moves in this category.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(bookings ?? []).map((b: any) => {
            const customer = customerMap.get(b.customer_id);
            const crew =
              teamMap.get(b.assigned_team_id)?.display_name ??
              companyMap.get(b.assigned_company_id)?.display_name;

            return (
              <Link
                key={b.id}
                href={`/admin-management/moves/${b.id}`}
                className="block bg-white border border-zinc-200 rounded-2xl p-5 hover:border-zinc-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: booking info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        {b.short_code ?? b.id.slice(0, 8).toUpperCase()}
                      </span>
                      <StatusBadge status={b.status} />
                      {b.scheduled_for_window && (
                        <span className="text-xs text-zinc-500 font-medium">
                          {b.scheduled_for_window}
                        </span>
                      )}
                    </div>

                    {/* Route */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-sm font-semibold text-zinc-900">
                        {b.pickup_line1 ? `${b.pickup_line1}, ` : ''}{b.pickup_city ?? '—'}
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0">
                        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                      </svg>
                      <div className="text-sm font-semibold text-zinc-900">
                        {b.dropoff_line1 ? `${b.dropoff_line1}, ` : ''}{b.dropoff_city ?? '—'}
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-4 flex-wrap">
                      <Field label="Date" value={fmtDate(b.scheduled_for_date)} />
                      {b.distance_km && <Field label="Distance" value={fmtDistance(b.distance_km)} />}
                      {b.duration_min && <Field label="Est. Duration" value={fmtDuration(b.duration_min)} />}
                      {customer && (
                        <Field label="Customer" value={customer.full_name ?? customer.email ?? customer.phone ?? 'Unknown'} />
                      )}
                      {crew && <Field label="Crew" value={crew} />}
                    </div>
                  </div>

                  {/* Right: financials — management only; staff see timing only */}
                  <div className="text-right shrink-0">
                    {isManagement ? (
                      <>
                        <div className="text-lg font-bold text-zinc-900">{fmtCents(b.price_total_cents)}</div>
                        <div className="text-sm font-semibold text-emerald-700">{fmtCents(b.movvy_margin_cents)} comm.</div>
                        {b.actual_total_cents && b.actual_total_cents !== b.price_total_cents && (
                          <div className="text-xs text-zinc-500 mt-1">
                            Actual: {fmtCents(b.actual_total_cents)}
                          </div>
                        )}
                      </>
                    ) : null}
                    <div className="text-xs text-zinc-400 mt-1">{fmtRelative(b.created_at)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3 mt-6">
          <PageLink tab={activeTab} q={search} page={page - 1} disabled={page <= 1} label="← Prev" />
          <span className="text-sm text-zinc-500">Page {page} of {totalPages}</span>
          <PageLink tab={activeTab} q={search} page={page + 1} disabled={page >= totalPages} label="Next →" />
        </div>
      ) : null}
    </div>
  );
}

function PageLink({ tab, q, page, disabled, label }: { tab: string; q: string; page: number; disabled: boolean; label: string }) {
  if (disabled) {
    return <span className="text-sm font-semibold text-zinc-300 px-3 py-1.5">{label}</span>;
  }
  const params = new URLSearchParams();
  if (q) params.set('q', q); else params.set('tab', tab);
  params.set('page', String(page));
  return (
    <Link href={`/admin-management/moves?${params.toString()}`} className="text-sm font-semibold text-zinc-700 hover:text-zinc-900 border border-zinc-200 rounded-lg px-3 py-1.5">
      {label}
    </Link>
  );
}

function TabLink({
  tab,
  active,
  label,
  count,
}: {
  tab: Tab;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={`/admin-management/moves?tab=${tab}`}
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
        active ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'
      }`}
    >
      {label}
      <span
        className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold ${
          active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600'
        }`}
      >
        {count}
      </span>
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

function Field({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div>
      <div className="text-xs uppercase font-semibold tracking-wider text-zinc-400">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${tone === 'warning' ? 'text-amber-700' : 'text-zinc-700'}`}>
        {value}
      </div>
    </div>
  );
}
