// =============================================================================
// /admin-management/payments — customer payments (Stripe direct charges).
//
// Management-only (shows money). Reads the `payments` ledger the stripe-webhook
// keeps in sync. Because Movvy pays crews MANUALLY off-platform, this page also
// surfaces the 80% crew share so Adam knows what to pay out against what was
// collected.
// =============================================================================

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtDateTime, fmtRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CREW_SHARE = 0.8; // crews keep 80%; Movvy keeps 20%

const STATUS_STYLE: Record<string, string> = {
  succeeded: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-amber-100 text-amber-700',
  failed: 'bg-zinc-200 text-zinc-600',
  refunded: 'bg-red-100 text-red-700',
  partially_refunded: 'bg-orange-100 text-orange-700',
  disputed: 'bg-red-100 text-red-700',
};

export default async function PaymentsPage() {
  const supabase = await supabaseServer();

  // Defence in depth — the layout hides the link from staff, and this re-checks.
  const access = await getAdminAccess(supabase);
  if (access !== 'management') redirect('/admin-management/dashboard');

  const { data: rows } = await supabase
    .from('payments')
    .select(
      'id, amount_cents, tip_cents, refunded_cents, status, currency, created_at, stripe_payment_intent_id, ' +
      'booking:bookings(short_code, pickup_city, dropoff_city), ' +
      'customer:profiles!payments_customer_id_fkey(full_name, email)',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const payments = rows ?? [];

  // Per-payment crew share: 80% of the MOVE portion + 100% of the tip.
  const paidRows = payments.filter((p: any) => ['succeeded', 'partially_refunded'].includes(p.status));
  const crewOwedFor = (p: any) => {
    const net = p.amount_cents - (p.refunded_cents ?? 0);
    const tip = Math.min(p.tip_cents ?? 0, Math.max(net, 0)); // guard if refunded below tip
    const moveNet = Math.max(net - tip, 0);
    return Math.round(moveNet * CREW_SHARE) + tip;
  };

  // Summary — only successful (net of refunds) money counts as collected.
  const collectedCents = paidRows.reduce(
    (sum: number, p: any) => sum + (p.amount_cents - (p.refunded_cents ?? 0)), 0);
  const refundedCents = payments.reduce((sum: number, p: any) => sum + (p.refunded_cents ?? 0), 0);
  const crewOwedCents = paidRows.reduce((sum: number, p: any) => sum + crewOwedFor(p), 0);
  const movvyCents = collectedCents - crewOwedCents;
  const successCount = payments.filter((p: any) => p.status === 'succeeded').length;

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Payments</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Card payments collected into Movvy&apos;s Stripe account · updates live from Stripe.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Collected (net)" value={fmtCents(collectedCents)} tone="emerald" />
        <SummaryCard label="Owed to crews (80%)" value={fmtCents(crewOwedCents)} tone="amber"
          hint="Pay these out manually" />
        <SummaryCard label="Movvy keeps (20%)" value={fmtCents(movvyCents)} tone="zinc" />
        <SummaryCard label="Refunded" value={fmtCents(refundedCents)} tone="red" />
      </div>

      {payments.length === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-12 text-center">
          <p className="text-sm font-semibold text-zinc-900">No payments yet</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            When a customer pays for a completed move in the app, it appears here. In test mode,
            run a move through the app and pay with card 4242 4242 4242 4242.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-5 py-3">Customer</th>
                <th className="text-left font-semibold px-5 py-3">Move</th>
                <th className="text-right font-semibold px-5 py-3">Amount</th>
                <th className="text-right font-semibold px-5 py-3">Crew owed</th>
                <th className="text-left font-semibold px-5 py-3">Status</th>
                <th className="text-right font-semibold px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => {
                const paid = ['succeeded', 'partially_refunded'].includes(p.status);
                return (
                  <tr key={p.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-zinc-900">{p.customer?.full_name ?? 'Customer'}</div>
                      <div className="text-xs text-zinc-400">{p.customer?.email ?? '—'}</div>
                    </td>
                    <td className="px-5 py-3">
                      {p.booking ? (
                        <Link href="/admin-management/moves" className="text-emerald-700 font-semibold hover:underline">
                          #{p.booking.short_code}
                        </Link>
                      ) : <span className="text-zinc-400">—</span>}
                      <div className="text-xs text-zinc-400">
                        {p.booking?.pickup_city ?? '—'} → {p.booking?.dropoff_city ?? 'in-home'}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-zinc-900">
                      {fmtCents(p.amount_cents)}
                      {p.tip_cents ? (
                        <div className="text-xs text-zinc-400 font-normal">incl. {fmtCents(p.tip_cents)} tip</div>
                      ) : null}
                      {p.refunded_cents ? (
                        <div className="text-xs text-red-600 font-normal">−{fmtCents(p.refunded_cents)} refunded</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-600">
                      {paid ? fmtCents(crewOwedFor(p)) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[p.status] ?? 'bg-zinc-200 text-zinc-600'}`}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-zinc-400" title={fmtDateTime(p.created_at)}>
                      {fmtRelative(p.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5 py-3 text-xs text-zinc-400 border-t border-zinc-100">
            {successCount} successful payment{successCount !== 1 ? 's' : ''} · showing last {payments.length}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone, hint }: {
  label: string; value: string; tone: 'emerald' | 'amber' | 'zinc' | 'red'; hint?: string;
}) {
  const toneClass = {
    emerald: 'text-emerald-700', amber: 'text-amber-700', zinc: 'text-zinc-900', red: 'text-red-700',
  }[tone];
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${toneClass}`}>{value}</div>
      {hint ? <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div> : null}
    </div>
  );
}
