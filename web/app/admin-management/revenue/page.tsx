// =============================================================================
// /admin-management/revenue — management-only revenue console.
//
// Triple-gated: (1) middleware requires an admin session, (2) this page
// requires access tier = 'management', (3) a 6-digit PIN unlock (signed
// httpOnly cookie, 8h). One screen: revenue + commission + payout totals, plus
// a per-move breakdown (cost, who ran it, driver payout, Movvy cut).
// =============================================================================

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { verifyRevenueToken, REVENUE_COOKIE } from '@/lib/revenueSession';
import { fmtCents, fmtStatus } from '@/lib/format';
import { PinGate } from './PinGate';
import { lockRevenue } from './actions';

export const dynamic = 'force-dynamic';

// Prefer the actual (post-move) figure, fall back to the booking estimate.
const eff = (actual: number | null | undefined, estimate: number | null | undefined) =>
  (actual ?? null) !== null ? (actual as number) : (estimate ?? 0);

export default async function RevenuePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin-management/login');

  // Gate 2 — management only. Staff never reach revenue.
  if ((await getAdminAccess(supabase)) !== 'management') {
    redirect('/admin-management/dashboard');
  }

  // Gate 3 — PIN. Ask the edge fn whether a PIN exists, then validate the
  // unlock cookie. Anything short of a valid token renders the lock screen.
  const { data: pinStatus } = await supabase.functions.invoke('admin-console', {
    body: { action: 'pin_status' },
  });
  const pinIsSet = !!pinStatus?.isSet;
  const token = (await cookies()).get(REVENUE_COOKIE)?.value;
  const unlocked = pinIsSet && verifyRevenueToken(token, user.id);

  if (!unlocked) {
    return <PinGate pinIsSet={pinIsSet} />;
  }

  // ─── Revenue data ──────────────────────────────────────────────────────────
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // All completed moves' money columns for totals (bounded at launch scale),
  // plus a richer recent set for the table.
  const [{ data: allCompleted }, { data: recent }] = await Promise.all([
    supabase
      .from('bookings')
      .select('actual_total_cents, price_total_cents, actual_driver_payout_cents, actual_commission_cents, movvy_margin_cents, created_at')
      .eq('status', 'completed'),
    supabase
      .from('bookings')
      .select('id, short_code, status, pickup_city, dropoff_city, scheduled_for_date, actual_hours, actual_total_cents, price_total_cents, actual_driver_payout_cents, actual_commission_cents, movvy_margin_cents, customer_id, assigned_team_id, assigned_company_id, created_at')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  const completed = allCompleted ?? [];
  const sum = (rows: any[], pick: (b: any) => number) => rows.reduce((s, b) => s + pick(b), 0);
  const thisMonth = completed.filter((b: any) => b.created_at >= monthStart.toISOString());

  const totalRevenue = sum(completed, (b) => eff(b.actual_total_cents, b.price_total_cents));
  const totalCommission = sum(completed, (b) => eff(b.actual_commission_cents, b.movvy_margin_cents));
  const totalPayout = sum(completed, (b) => eff(b.actual_driver_payout_cents, null) || (eff(b.actual_total_cents, b.price_total_cents) - eff(b.actual_commission_cents, b.movvy_margin_cents)));
  const monthRevenue = sum(thisMonth, (b) => eff(b.actual_total_cents, b.price_total_cents));
  const monthCommission = sum(thisMonth, (b) => eff(b.actual_commission_cents, b.movvy_margin_cents));

  // Resolve crew + customer names for the recent table.
  const rows = recent ?? [];
  const customerIds = [...new Set(rows.map((b: any) => b.customer_id).filter(Boolean))];
  const teamIds = [...new Set(rows.map((b: any) => b.assigned_team_id).filter(Boolean))];
  const companyIds = [...new Set(rows.map((b: any) => b.assigned_company_id).filter(Boolean))];
  const [{ data: customers }, { data: teams }, { data: companies }] = await Promise.all([
    customerIds.length ? supabase.from('profiles').select('id, full_name').in('id', customerIds) : Promise.resolve({ data: [] as any[] }),
    teamIds.length ? supabase.from('partner_teams').select('id, display_name').in('id', teamIds) : Promise.resolve({ data: [] as any[] }),
    companyIds.length ? supabase.from('companies').select('id, display_name').in('id', companyIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const customerMap = new Map((customers ?? []).map((c: any) => [c.id, c.full_name]));
  const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.display_name]));
  const companyMap = new Map((companies ?? []).map((c: any) => [c.id, c.display_name]));

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Revenue</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Completed moves · {completed.length} total. Figures use actual billed amounts where available.
          </p>
        </div>
        <form action={lockRevenue}>
          <button className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded-lg px-3 py-2">
            Lock revenue
          </button>
        </form>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Kpi label="Total revenue" value={fmtCents(totalRevenue)} sub={`${fmtCents(monthRevenue)} this month`} accent />
        <Kpi label="Movvy commission" value={fmtCents(totalCommission)} sub={`${fmtCents(monthCommission)} this month`} />
        <Kpi label="Driver payouts" value={fmtCents(totalPayout)} sub="Paid to crews" />
        <Kpi label="Completed moves" value={String(completed.length)} sub={`${thisMonth.length} this month`} />
      </div>

      {/* Per-move breakdown */}
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 text-sm font-semibold text-zinc-900">
          Recent completed moves
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                <th className="px-5 py-2.5 font-semibold">Move</th>
                <th className="px-5 py-2.5 font-semibold">Route</th>
                <th className="px-5 py-2.5 font-semibold">Customer</th>
                <th className="px-5 py-2.5 font-semibold">Crew</th>
                <th className="px-5 py-2.5 font-semibold text-right">Move cost</th>
                <th className="px-5 py-2.5 font-semibold text-right">Driver payout</th>
                <th className="px-5 py-2.5 font-semibold text-right">Movvy cut</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-zinc-400">No completed moves yet.</td></tr>
              ) : rows.map((b: any) => {
                const cost = eff(b.actual_total_cents, b.price_total_cents);
                const commission = eff(b.actual_commission_cents, b.movvy_margin_cents);
                const payout = eff(b.actual_driver_payout_cents, null) || (cost - commission);
                const crew = b.assigned_team_id ? teamMap.get(b.assigned_team_id)
                  : b.assigned_company_id ? companyMap.get(b.assigned_company_id) : null;
                return (
                  <tr key={b.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-zinc-900">#{b.short_code}</div>
                      <div className="text-xs text-zinc-400">
                        {b.scheduled_for_date ? new Date(b.scheduled_for_date + 'T00:00:00').toLocaleDateString('en-CA') : '—'}
                        {b.actual_hours ? ` · ${b.actual_hours}h` : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-zinc-700">{b.pickup_city ?? '—'} → {b.dropoff_city ?? 'in-home'}</td>
                    <td className="px-5 py-3 text-zinc-700">{customerMap.get(b.customer_id) ?? '—'}</td>
                    <td className="px-5 py-3 text-zinc-700">{crew ?? <span className="text-zinc-400">Unassigned</span>}</td>
                    <td className="px-5 py-3 text-right font-semibold text-zinc-900">{fmtCents(cost)}</td>
                    <td className="px-5 py-3 text-right text-zinc-700">{fmtCents(payout)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-emerald-700">{fmtCents(commission)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-emerald-200 bg-emerald-50' : 'border-zinc-200 bg-white'}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-zinc-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}
