// =============================================================================
// /admin-management/moves — operational moves view.
//
// Three lenses on the same bookings table:
//   1. Active   — currently in-progress (driver dispatched, in transit, etc.)
//   2. Today    — scheduled for today (any status)
//   3. Upcoming — scheduled in the next 7 days
//
// Default to Active because that's the one the founder is checking when
// they tab over here mid-day. The tab is reflected in ?tab= so the URL
// can be bookmarked.
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtCents, fmtDate, fmtStatus, fmtRelative } from '@/lib/format';

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
  searchParams: Promise<{ tab?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function MovesPage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  const activeTab: Tab = (tab as Tab) || 'active';

  const supabase = await supabaseServer();

  // Compute date windows once. Today / upcoming use scheduled_for_date,
  // not created_at — we want to see what's on the calendar, not what
  // was booked today.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const sevenDays = new Date(today.getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Build the active-tab query; the other two tabs share the same SELECT.
  const baseSelect =
    'id, short_code, status, pickup_city, pickup_line1, dropoff_city, dropoff_line1, scheduled_for_date, scheduled_for_window, price_total_cents, movvy_margin_cents, created_at, distance_km, duration_min, customer_id, assigned_team_id, assigned_company_id';

  let query = supabase.from('bookings').select(baseSelect);
  if (activeTab === 'active') {
    query = query.in('status', ACTIVE_STATUSES).order('scheduled_for_date');
  } else if (activeTab === 'today') {
    query = query.eq('scheduled_for_date', todayIso).order('scheduled_for_window');
  } else {
    query = query
      .gte('scheduled_for_date', todayIso)
      .lte('scheduled_for_date', sevenDays)
      .order('scheduled_for_date');
  }
  query = query.limit(100);

  const { data: bookings } = await query;

  // Run three count queries in parallel so each tab shows its size,
  // not just the currently active one. Same filters, head-only.
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

  // Look up customer + crew names in batch — one query per join column.
  const customerIds = Array.from(
    new Set((bookings ?? []).map((b: any) => b.customer_id).filter(Boolean)),
  );
  const teamIds = Array.from(
    new Set(
      (bookings ?? [])
        .map((b: any) => b.assigned_team_id)
        .filter(Boolean),
    ),
  );
  const companyIds = Array.from(
    new Set(
      (bookings ?? [])
        .map((b: any) => b.assigned_company_id)
        .filter(Boolean),
    ),
  );

  const [{ data: customers }, { data: teams }, { data: companies }] =
    await Promise.all([
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

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Moves</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Operational view of what's happening + what's coming up.
        </p>
      </div>

      <div className="flex gap-1 mb-6 bg-zinc-100 rounded-2xl p-1 w-fit">
        <TabLink
          tab="active"
          active={activeTab === 'active'}
          label="Active"
          count={activeCount.count ?? 0}
        />
        <TabLink
          tab="today"
          active={activeTab === 'today'}
          label="Today"
          count={todayCount.count ?? 0}
        />
        <TabLink
          tab="upcoming"
          active={activeTab === 'upcoming'}
          label="Upcoming"
          count={upcomingCount.count ?? 0}
        />
      </div>

      {(bookings ?? []).length === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-10 text-center">
          <p className="text-sm font-semibold text-zinc-900">
            {activeTab === 'active'
              ? 'No moves are in progress right now.'
              : activeTab === 'today'
              ? 'Nothing scheduled for today.'
              : 'Nothing scheduled in the next 7 days.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings?.map((b: any) => {
            const customer = customerMap.get(b.customer_id);
            const team = teamMap.get(b.assigned_team_id);
            const company = companyMap.get(b.assigned_company_id);
            const crew = team?.display_name ?? company?.display_name ?? 'Unassigned';
            return (
              <div
                key={b.id}
                className="rounded-2xl bg-white border border-zinc-200 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-bold text-zinc-900">
                      #{b.short_code}{' '}
                      <span className="text-xs font-normal text-zinc-500 ml-1">
                        booked {fmtRelative(b.created_at)}
                      </span>
                    </div>
                    <div className="mt-1">
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-zinc-900">
                      {fmtCents(b.price_total_cents)}
                    </div>
                    <div className="text-xs text-emerald-700 font-semibold">
                      +{fmtCents(b.movvy_margin_cents)} to Movvy
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-100">
                  <Field
                    label="Customer"
                    value={
                      customer?.full_name ?? customer?.email ?? customer?.phone ?? '—'
                    }
                  />
                  <Field
                    label="Crew"
                    value={crew}
                    tone={crew === 'Unassigned' ? 'warning' : 'normal'}
                  />
                  <Field
                    label="Scheduled"
                    value={`${fmtDate(b.scheduled_for_date)} · ${b.scheduled_for_window ?? '—'}`}
                  />
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-600">
                  <div>
                    <span className="font-semibold text-zinc-900">From: </span>
                    {b.pickup_line1}, {b.pickup_city}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-zinc-900">To: </span>
                    {b.dropoff_line1
                      ? `${b.dropoff_line1}, ${b.dropoff_city}`
                      : 'In-home / labor only'}
                  </div>
                  {b.distance_km ? (
                    <div className="mt-1 text-zinc-500">
                      {b.distance_km} km · ~{b.duration_min} min drive
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
        active
          ? 'bg-white text-zinc-900 shadow-sm'
          : 'text-zinc-600 hover:text-zinc-900'
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

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning';
}) {
  return (
    <div>
      <div className="text-xs uppercase font-semibold tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={`text-sm font-semibold mt-1 ${
          tone === 'warning' ? 'text-amber-700' : 'text-zinc-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
