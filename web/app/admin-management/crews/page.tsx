// =============================================================================
// /admin-management/crews — the crew payout directory.
//
// The Payouts page answers "what has been ASKED for". This one answers the
// question that had nowhere to live: for every crew Movvy works with, who is on
// it, where their money goes, and when that destination last changed.
//
// Why it isn't a section on Payouts: that page is driven by payout_requests and
// admin_crew_balances(), and both deliberately only surface crews with activity.
// A crew with banking on file that hasn't worked yet, or one whose balance is
// zero because it was just paid, is invisible there — which is exactly the crew
// you're looking for when you're checking whether their details are right.
//
// MANAGEMENT ONLY. This page prints banking details in full (holder,
// institution, transit, account tail, e-Transfer address). The RLS policy on
// companies allows is_admin(), which is TRUE for the staff tier — so RLS is not
// the backstop here and hiding the nav link is not a control. The check below
// is. admin_crew_payout_directory() also gates on is_full_admin() internally,
// so a staff session gets an empty list even if it reaches the query.
// =============================================================================

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtDateTime, fmtRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Crew = {
  company_id: string;
  display_name: string | null;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  hq_city_name: string | null;
  onboarding_status: string | null;
  suspended_at: string | null;
  crew_size: number;
  admin_count: number;
  member_count: number;
  payout_method: 'bank' | 'etransfer' | 'none';
  etransfer_email: string | null;
  bank_holder_name: string | null;
  bank_institution_number: string | null;
  bank_transit_number: string | null;
  bank_account_last4: string | null;
  bank_updated_at: string | null;
  bank_change_count: number;
  jobs_completed: number;
  owed_cents: number;
  in_hold_cents: number;
  tips_cents: number;
  penalties_cents: number;
  claimed_cents: number;
  lifetime_paid_cents: number;
  open_request_id: string | null;
  open_request_status: string | null;
  open_request_cents: number;
  last_paid_at: string | null;
};

export default async function CrewsPage() {
  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (access !== 'management') redirect('/admin-management/dashboard');

  const { data, error } = await supabase.rpc('admin_crew_payout_directory');
  const crews = (data ?? []) as Crew[];

  const totalOwed = crews.reduce((s, c) => s + Number(c.owed_cents ?? 0), 0);
  const totalHold = crews.reduce((s, c) => s + Number(c.in_hold_cents ?? 0), 0);
  const totalPaid = crews.reduce((s, c) => s + Number(c.lifetime_paid_cents ?? 0), 0);
  // A crew that has finished work but has no way to be paid is the one thing on
  // this page that needs chasing, so it gets counted at the top.
  const missingDetails = crews.filter(
    (c) => c.payout_method === 'none' && (c.jobs_completed > 0 || c.owed_cents > 0),
  );

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Crews</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {crews.length} crew{crews.length === 1 ? '' : 's'} · payout destinations and balances
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Stat label="Owed now" value={fmtCents(totalOwed)} tone="amber" />
          <Stat label="Still in hold" value={fmtCents(totalHold)} />
          <Stat label="Paid all time" value={fmtCents(totalPaid)} tone="emerald" />
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load the directory: {error.message}
        </p>
      ) : null}

      {missingDetails.length > 0 ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">
            {missingDetails.length} crew{missingDetails.length === 1 ? ' has' : 's have'} earned money
            with no payout details on file.
          </span>{' '}
          {missingDetails.map((c) => c.display_name ?? c.legal_name).join(', ')} — they can&apos;t
          request a payout until they add one in the app.
        </p>
      ) : null}

      {crews.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-10 text-center">
          <p className="text-sm font-semibold text-zinc-900">No crews yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Approved crews appear here with their payout details as soon as they sign up.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {crews.map((c) => (
            <CrewCard key={c.company_id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CrewCard({ c }: { c: Crew }) {
  const name = c.display_name ?? c.legal_name ?? 'Crew';
  const noDestination = c.payout_method === 'none';

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Identity + headcount */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-zinc-900">{name}</span>
            {c.legal_name && c.legal_name !== name ? (
              <span className="text-xs text-zinc-400">{c.legal_name}</span>
            ) : null}
            {c.suspended_at ? (
              <Pill tone="red">Suspended</Pill>
            ) : c.onboarding_status === 'verified' ? (
              <Pill tone="emerald">Verified</Pill>
            ) : (
              <Pill tone="zinc">{c.onboarding_status ?? 'unverified'}</Pill>
            )}
            {c.open_request_status ? (
              <Pill tone="amber">
                {c.open_request_status} · {fmtCents(c.open_request_cents)}
              </Pill>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            {/* Spelled out rather than a bare number: "3" next to a crew name
                reads as jobs, trucks or anything else. */}
            <span>
              <span className="font-semibold text-zinc-800">{c.crew_size}</span>{' '}
              {c.crew_size === 1 ? 'person' : 'people'}
              {c.crew_size > 0 ? ` (${c.admin_count} admin, ${c.member_count} crew)` : ''}
            </span>
            {c.hq_city_name ? <span>· {c.hq_city_name}</span> : null}
            {c.email ? <span>· {c.email}</span> : null}
            {c.phone ? <span>· {c.phone}</span> : null}
            <span>
              · <span className="font-semibold text-zinc-800">{c.jobs_completed}</span> paid move
              {c.jobs_completed === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold text-zinc-900">{fmtCents(c.owed_cents)}</div>
          <div className="text-xs text-zinc-400">owed now</div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        {/* Where the money goes */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Payout destination
          </h3>
          {noDestination ? (
            <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">
              Nothing on file. This crew can&apos;t request a payout until they add bank details or
              an e-Transfer address in the app.
            </p>
          ) : (
            <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs">
              <div className="mb-2">
                <Pill tone="zinc">
                  {c.payout_method === 'bank' ? 'Bank deposit' : 'e-Transfer'}
                </Pill>
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Field label="Account holder" value={c.bank_holder_name} />
                <Field label="Institution" value={c.bank_institution_number} />
                <Field label="Transit" value={c.bank_transit_number} />
                <Field
                  label="Account"
                  value={c.bank_account_last4 ? `••••${c.bank_account_last4}` : null}
                />
                <Field label="e-Transfer" value={c.etransfer_email} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {c.bank_updated_at ? (
                  <>
                    Last changed {fmtRelative(c.bank_updated_at)} ({fmtDateTime(c.bank_updated_at)})
                    {c.bank_change_count > 1 ? ` · ${c.bank_change_count} changes on record` : ''}
                  </>
                ) : (
                  'No change on record — these details predate change tracking.'
                )}
              </p>
            </div>
          )}
        </div>

        {/* The money itself */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Balance</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <Money label="Owed now" value={c.owed_cents} bold />
            <Money label="Still in hold" value={c.in_hold_cents} />
            {/* Tips are 100% the crew's, so they're never folded into the
                payout figure — they're called out on their own line. */}
            <Money label="Tips (in owed)" value={c.tips_cents} tone="emerald" />
            <Money label="Penalties" value={c.penalties_cents} tone={c.penalties_cents > 0 ? 'red' : undefined} />
            <Money label="Requested to date" value={c.claimed_cents} />
            <Money label="Paid to date" value={c.lifetime_paid_cents} />
          </dl>
          <p className="mt-2 text-xs text-zinc-500">
            {c.last_paid_at
              ? `Last paid ${fmtRelative(c.last_paid_at)}.`
              : 'Never been paid out.'}{' '}
            Money in hold becomes requestable the second Monday after the move finishes.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="font-mono text-sm font-semibold text-zinc-900 select-all">{value ?? '—'}</dd>
    </div>
  );
}

function Money({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: number;
  bold?: boolean;
  tone?: 'emerald' | 'red';
}) {
  const colour =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : 'text-zinc-900';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`${bold ? 'font-bold' : 'font-semibold'} ${colour}`}>
        {fmtCents(value)}
      </dd>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'red' | 'emerald' | 'amber' | 'zinc' }) {
  const map = {
    red: 'bg-red-50 text-red-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    zinc: 'bg-zinc-100 text-zinc-600',
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'emerald' }) {
  const map = {
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-2 ${tone ? map[tone] : 'border-zinc-200 bg-white text-zinc-900'}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
