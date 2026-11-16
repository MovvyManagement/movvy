// =============================================================================
// /admin-management/refunds — money Movvy is holding that belongs to customers.
//
// Two ways a customer ends up owed:
//   • CANCELLED with the deposit still held. The hourly expiry job cancels a
//     request nobody accepted without refunding it, and a cancellation whose
//     Stripe refund call failed leaves the deposit 'paid' on purpose so a
//     person follows up. Deposits kept under the 48-hour rule are 'forfeited'
//     and never appear here.
//   • FINISHED under the deposit. A deposit is 20% of the estimate and the bill
//     is the actual time, so a move finished far faster than estimated (or a
//     crew tapping Finish early) leaves the customer in credit. Rare.
//
// Refunds are issued HERE by hand rather than automatically: money that has
// already left is far harder to walk back than money still in a list.
//
// The list is derived, not a table of flags: a move is here exactly while
// Movvy holds more of its deposit than it earned, and it disappears the moment
// the Stripe webhook records the refund. Nothing to tick off.
//
// MANAGEMENT ONLY. Rows carry payment intent ids and customer contact details,
// and issuing moves real money. admin_refunds_owed() also checks
// movvy_admin_access() on its own.
// =============================================================================

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtDateTime, fmtRelative } from '@/lib/format';
import { RefundButton } from './RefundButton';

export const dynamic = 'force-dynamic';

type Owed = {
  booking_id: string;
  short_code: string | null;
  kind: 'cancelled' | 'overpaid';
  happened_at: string | null;
  cancellation_reason: string | null;
  customer_name: string | null;
  customer_email: string | null;
  estimate_cents: number | null;
  actual_total_cents: number | null;
  deposit_cents: number | null;
  credit_applied_cents: number;
  deposit_refunded_cents: number;
  owed_cents: number;
  deposit_payment_intent_id: string | null;
  payment_status: string | null;
};

export default async function RefundsPage() {
  const supabase = await supabaseServer();
  if ((await getAdminAccess(supabase)) !== 'management') {
    redirect('/admin-management/dashboard');
  }

  const { data, error } = await supabase.rpc('admin_refunds_owed');
  const rows = (data ?? []) as Owed[];
  const total = rows.reduce((s, r) => s + Number(r.owed_cents ?? 0), 0);
  const { data: liveFlag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'stripe_live_enabled')
    .maybeSingle();
  const testMode = liveFlag?.enabled !== true;

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Refunds owed</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
            Deposits Movvy is still holding that belong to customers. Each refund goes back to the
            card the customer paid with, and the move leaves this list once Stripe confirms it.
          </p>
          {testMode ? (
            <p className="mt-1 text-xs font-semibold text-zinc-500">
              Stripe is in test mode, so these refunds move test money only.
            </p>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2">
            <div className="text-xs text-amber-700">Owed to customers</div>
            <div className="text-lg font-bold text-amber-800">{fmtCents(total)}</div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load the queue: {error.message}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-10 text-center">
          <p className="text-sm font-semibold text-zinc-900">Nothing owed</p>
          <p className="mt-1 text-sm text-zinc-500">
            Every cancelled move&apos;s deposit has been refunded or kept under the 48-hour rule,
            and every finished move was billed at or above its deposit.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const partial = r.deposit_refunded_cents > 0;
            return (
              <div key={r.booking_id} className="rounded-2xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin-management/moves/${r.booking_id}`}
                        className="text-base font-bold text-zinc-900 hover:underline"
                      >
                        {r.short_code ?? 'Move'}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.kind === 'cancelled' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {r.kind === 'cancelled' ? 'Cancelled, deposit held' : 'Billed under the deposit'}
                      </span>
                      {partial ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                          {fmtCents(r.deposit_refunded_cents)} already refunded
                        </span>
                      ) : null}
                      {/* A move can be owed a refund and still show as
                          uncharged — the deposit covered everything, so the
                          final charge never ran. Say so, or it reads as a
                          missing payment. */}
                      {r.kind === 'overpaid' && r.payment_status === 'uncharged' ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                          No final charge — deposit covered it
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {r.customer_name ?? 'Customer'}
                      {r.customer_email ? ` · ${r.customer_email}` : ''}
                      {r.happened_at
                        ? ` · ${r.kind === 'cancelled' ? 'cancelled' : 'finished'} ${fmtRelative(r.happened_at)} (${fmtDateTime(r.happened_at)})`
                        : ''}
                    </div>
                    {r.kind === 'cancelled' && r.cancellation_reason ? (
                      <div className="mt-1 text-xs text-zinc-600">{r.cancellation_reason}</div>
                    ) : null}

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <Fig label="Estimate" value={fmtCents(r.estimate_cents ?? 0)} />
                      {r.kind === 'overpaid' ? (
                        <Fig label="Actual bill" value={fmtCents(r.actual_total_cents ?? 0)} strong />
                      ) : null}
                      <Fig label="Deposit paid" value={fmtCents(r.deposit_cents ?? 0)} strong={r.kind === 'cancelled'} />
                      {r.credit_applied_cents > 0 ? (
                        <Fig label="Credit applied" value={fmtCents(r.credit_applied_cents)} />
                      ) : null}
                    </dl>

                    {!r.deposit_payment_intent_id ? (
                      <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
                        No deposit payment on file for this move — it can&apos;t be refunded to a
                        card from here. Settle it manually.
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-2xl font-bold text-emerald-700">
                      {fmtCents(r.owed_cents)}
                    </div>
                    <div className="mb-2 text-xs text-zinc-400">owed back</div>
                    {r.deposit_payment_intent_id ? (
                      <RefundButton
                        bookingId={r.booking_id}
                        amount={fmtCents(r.owed_cents)}
                        shortCode={r.short_code ?? 'this move'}
                        customer={r.customer_name ?? 'the customer'}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className={strong ? 'font-bold text-zinc-900' : 'font-semibold text-zinc-700'}>
        {value}
      </dd>
    </div>
  );
}
