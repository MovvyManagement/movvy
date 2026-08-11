// =============================================================================
// /admin-management/payouts — the withdrawal queue.
//
// Payouts run on a weekly Monday cycle (0109). A crew requests on a Monday, and
// the request covers completed, collected moves that finished BEFORE the
// previous Monday — so a 7–14 day lag depending on the day, which leaves room
// for a dispute to surface before the money is gone. Unclaimed amounts roll into
// the next Monday. There is no automated rail: this page hands you the amount
// and the destination, you send the e-Transfer, and you record it.
//
// The banking details shown are the ones FROZEN at request time, not whatever
// the org's profile says today. If a crew account were taken over and the
// payout email changed, this page shows where the money was meant to go when
// the request was made — and any mismatch with the live profile is called out.
// =============================================================================

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtDateTime, fmtRelative } from '@/lib/format';
import { PayoutActions } from './PayoutActions';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const supabase = await supabaseServer();

  // MANAGEMENT ONLY. This page prints crew banking details — e-Transfer address,
  // institution, transit, account tail — and the RLS policy on payout_requests
  // allows is_admin(), which is TRUE for the staff tier (0055 syncs a staff
  // console user to profiles.role = 'movvy_support'). So RLS is not a backstop
  // here and the layout hiding the link is not a control: without this check a
  // staff user who types the URL reads every crew's banking information.
  const access = await getAdminAccess(supabase);
  if (access !== 'management') redirect('/admin-management/dashboard');

  const { data: requests } = await supabase
    .from('payout_requests')
    .select(
      'id, company_id, amount_cents, method, status, created_at, processed_at, reference, admin_note, ' +
      'etransfer_email, bank_holder_name, bank_institution_number, bank_transit_number, bank_account_last4, ' +
      'companies(display_name, legal_name, email, phone, etransfer_email, bank_account_last4), ' +
      'profiles:requested_by(full_name, email)',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  // What Movvy owes each crew RIGHT NOW, whether or not they've asked for it.
  // Same math as the crew's own screen (0103/0104), so the number here and the
  // number in their app can't disagree. Recording a payment below subtracts
  // from this automatically — `claimed` counts paid requests.
  const { data: balances } = await supabase.rpc('admin_crew_balances');
  const crewBalances = (balances ?? []) as any[];
  const totalOwed = crewBalances.reduce((s: number, b: any) => s + Number(b.owed_cents ?? 0), 0);

  const rows = requests ?? [];
  const pending = rows.filter((r: any) => r.status === 'pending');
  const settled = rows.filter((r: any) => r.status !== 'pending');
  const owed = pending.reduce((sum: number, r: any) => sum + (r.amount_cents ?? 0), 0);

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Payouts</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {pending.length > 0
            ? `${pending.length} crew${pending.length === 1 ? '' : 's'} waiting on ${fmtCents(owed)}`
            : 'No withdrawal requests waiting. Crews request on Mondays, covering moves finished before the previous Monday.'}
        </p>
      </div>

      {/* ── Owed to crews ────────────────────────────────────────────────────
          Total liability, including crews who haven't requested yet. Before
          this, the console only showed requests, so the only way to know what
          you owed was to wait for someone to ask. */}
      {crewBalances.length > 0 ? (
        <div className="mb-8 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="flex items-baseline justify-between px-4 py-3 border-b border-zinc-200 bg-zinc-50">
            <div className="text-sm font-semibold text-zinc-900">Owed to crews</div>
            <div className="text-sm font-bold text-zinc-900 tabular-nums">{fmtCents(totalOwed)} total</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Crew</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Owed now</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Not yet due</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Of which tips</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Requested</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Paid to date</th>
                </tr>
              </thead>
              <tbody>
                {crewBalances.map((b: any) => (
                  <tr key={b.company_id} className="border-b border-zinc-100 last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-zinc-900">{b.display_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-zinc-900 tabular-nums">
                      {fmtCents(Number(b.owed_cents))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums">
                      {Number(b.in_hold_cents) > 0 ? fmtCents(Number(b.in_hold_cents)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-600 tabular-nums">
                      {Number(b.tips_cents) > 0 ? fmtCents(Number(b.tips_cents)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {b.open_request_id ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {b.open_request_status} · {fmtCents(Number(b.open_request_cents))}
                        </span>
                      ) : (
                        <span className="text-zinc-400">not requested</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums">
                      {fmtCents(Number(b.lifetime_paid_cents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-xs text-zinc-500 border-t border-zinc-200 bg-zinc-50">
            &quot;Owed now&quot; is money collected from the customer, from moves
            finished before the previous Monday, not yet paid out or claimed by an
            open request. &quot;Not yet due&quot; is earned and collected but too
            recent for this week&apos;s window. Marking a request sent below
            subtracts it here and in the crew&apos;s own app.
          </div>
        </div>
      ) : null}

      <Section title="Waiting to be sent" count={pending.length} empty="Nothing to pay right now.">
        {pending.map((r: any) => {
          const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
          const who = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
          // The destination could have been edited after the request was filed.
          const changed =
            r.method === 'etransfer'
              ? !!co?.etransfer_email && co.etransfer_email !== r.etransfer_email
              : !!co?.bank_account_last4 && co.bank_account_last4 !== r.bank_account_last4;

          return (
            <div key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-zinc-900">
                      {co?.display_name ?? co?.legal_name ?? 'Crew'}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {r.method === 'etransfer' ? 'e-Transfer' : 'Bank deposit'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Requested {fmtRelative(r.created_at)} by {who?.full_name ?? who?.email ?? 'crew admin'}
                    {co?.phone ? ` · ${co.phone}` : ''}
                  </div>

                  <div className="mt-3 rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-xs">
                    {r.method === 'etransfer' ? (
                      <div>
                        <span className="text-zinc-500">Send e-Transfer to</span>
                        <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-900 select-all">
                          {r.etransfer_email ?? '— none on file —'}
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                        <Field label="Account holder" value={r.bank_holder_name} />
                        <Field label="Institution" value={r.bank_institution_number} />
                        <Field label="Transit" value={r.bank_transit_number} />
                        <Field label="Account" value={r.bank_account_last4 ? `••••${r.bank_account_last4}` : null} />
                      </div>
                    )}
                    {changed ? (
                      <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
                        <span className="font-semibold">Details changed since this request.</span>{' '}
                        The crew's profile now shows{' '}
                        {r.method === 'etransfer' ? co?.etransfer_email : `••••${co?.bank_account_last4}`}.
                        Confirm with them before sending.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-2xl font-bold text-zinc-900">{fmtCents(r.amount_cents)}</div>
                  <div className="mt-3">
                    <PayoutActions id={r.id} amount={fmtCents(r.amount_cents)} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="History" count={settled.length} empty="No completed payouts yet.">
        {settled.map((r: any) => {
          const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
          const tone =
            r.status === 'paid' ? 'bg-emerald-50 text-emerald-700'
            : r.status === 'rejected' ? 'bg-red-50 text-red-700'
            : 'bg-zinc-100 text-zinc-600';
          return (
            <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-900">
                    {co?.display_name ?? co?.legal_name ?? 'Crew'}
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${tone}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {r.processed_at ? fmtDateTime(r.processed_at) : fmtDateTime(r.created_at)}
                  {r.reference ? ` · ref ${r.reference}` : ''}
                  {r.admin_note ? ` · ${r.admin_note}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-sm font-bold text-zinc-900">{fmtCents(r.amount_cents)}</div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-zinc-500">{label}</span>
      <div className="font-mono text-sm font-semibold text-zinc-900 select-all">{value ?? '—'}</div>
    </div>
  );
}

function Section({
  title, count, empty, children,
}: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-700">{count}</span>
      </div>
      {count === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-5 py-6 text-center text-sm text-zinc-500">
          {empty}
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {children}
        </div>
      )}
    </div>
  );
}
