// =============================================================================
// /admin-management/approvals — applicant queue.
//
// Enhancements over v1:
// · Days pending shown (urgency indicator for old applications)
// · Document count pulled from verification_documents
// · City context shown
// · Status badge with colour coding
// · Quick-view applicant details inline
// · Separate counts for teams vs companies in the header
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtRelative, fmtStatus, fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const REVIEW_STATUSES = ['in_review', 'docs_uploaded', 'in_progress'];

export default async function ApprovalsPage() {
  const supabase = await supabaseServer();

  const [{ data: teams }, { data: companies }, { data: docCounts }, { data: truckDocs }] =
    await Promise.all([
    supabase
      .from('partner_teams')
      .select('id, display_name, primary_city_id, onboarding_status, created_at, invite_code')
      .in('onboarding_status', REVIEW_STATUSES)
      .order('created_at', { ascending: false }),
    supabase
      .from('companies')
      .select('id, legal_name, display_name, primary_city_id, onboarding_status, created_at, invite_code, registration_number')
      .in('onboarding_status', REVIEW_STATUSES)
      .order('created_at', { ascending: false }),
    // Verification document counts per subject. The subject is whichever of
    // the three id columns is set (see the vd_one_subject constraint) — there
    // is no `entity_id` column, which is why these counts used to be blank.
    supabase
      .from('verification_documents')
      .select('company_id, team_id, profile_id, status')
      .in('status', ['pending', 'approved', 'rejected']),
    // Truck paperwork awaiting review. This is its OWN queue because a truck
    // gets added long after the org itself was approved — those orgs are no
    // longer in the applicant list above, so without this the registration sits
    // 'pending' forever and the crew can never accept a job.
    supabase
      .from('verification_documents')
      .select('id, kind, status, created_at, company_id, companies(display_name, legal_name)')
      .in('kind', ['vehicle_registration', 'insurance'])
      .eq('status', 'pending')
      .not('company_id', 'is', null)
      .order('created_at', { ascending: true }),
  ]);

  // Build doc count map: subject id → { pending, approved, total }
  const docMap: Record<string, { pending: number; approved: number; total: number }> = {};
  (docCounts ?? []).forEach((d: any) => {
    const key = d.company_id ?? d.team_id ?? d.profile_id;
    if (!key) return;
    if (!docMap[key]) docMap[key] = { pending: 0, approved: 0, total: 0 };
    docMap[key].total++;
    if (d.status === 'pending') docMap[key].pending++;
    if (d.status === 'approved') docMap[key].approved++;
  });

  // One row per org with pending truck paperwork.
  const truckQueue = Object.values(
    (truckDocs ?? []).reduce((acc: Record<string, any>, d: any) => {
      const cid = d.company_id as string;
      const co = Array.isArray(d.companies) ? d.companies[0] : d.companies;
      if (!acc[cid]) {
        acc[cid] = {
          company_id: cid,
          name: co?.display_name ?? co?.legal_name ?? 'Partner',
          kinds: [] as string[],
          created_at: d.created_at,
        };
      }
      acc[cid].kinds.push(d.kind);
      if (d.created_at < acc[cid].created_at) acc[cid].created_at = d.created_at;
      return acc;
    }, {}),
  ) as { company_id: string; name: string; kinds: string[]; created_at: string }[];

  const total = (teams?.length ?? 0) + (companies?.length ?? 0);

  // Days pending helper
  const daysPending = (createdAt: string) => {
    const ms = Date.now() - new Date(createdAt).getTime();
    return Math.floor(ms / 86_400_000);
  };

  return (
    <div className="px-6 py-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Approvals</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {total > 0 || truckQueue.length > 0
            ? [
                total > 0
                  ? `${total} applicant${total !== 1 ? 's' : ''} awaiting review`
                  : null,
                truckQueue.length > 0
                  ? `${truckQueue.length} truck${truckQueue.length !== 1 ? 's' : ''} waiting on paperwork`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Nothing in the queue. New applications and truck paperwork appear here automatically.'}
        </p>
      </div>

      {/* Stale applications warning */}
      {total > 0 && (() => {
        const stale = [...(teams ?? []), ...(companies ?? [])].filter(
          (a: any) => daysPending(a.created_at) > 7,
        );
        return stale.length > 0 ? (
          <div className="mb-5 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3 flex items-center gap-3">
            <svg className="text-amber-600 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{stale.length} application{stale.length !== 1 ? 's' : ''}</span> pending for more than 7 days.
            </p>
          </div>
        ) : null;
      })()}

      {/* Trucks — blocks the partner from accepting ANY job until approved. */}
      <Section
        title="Truck paperwork"
        count={truckQueue.length}
        empty="No truck registrations or insurance waiting on review."
      >
        {truckQueue.map((t) => (
          <Link
            key={t.company_id}
            href={`/admin-management/approvals/company/${t.company_id}`}
            className="flex items-center px-5 py-4 hover:bg-zinc-50 transition-colors gap-4"
          >
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 text-sm font-bold">
              🚚
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-bold text-zinc-900 truncate">{t.name}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                  Blocking job acceptance
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                {t.kinds
                  .map((k) => (k === 'vehicle_registration' ? 'Registration' : 'Insurance'))
                  .join(' · ')}{' '}
                · uploaded {fmtDate(t.created_at)}
              </div>
            </div>
            <div className="text-xs text-zinc-400 whitespace-nowrap shrink-0">
              {fmtRelative(t.created_at)}
            </div>
            <svg
              className="h-4 w-4 text-zinc-300 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        ))}
      </Section>

      {/* Teams */}
      <Section title="Two-person crews" count={teams?.length ?? 0} empty="No crew applications pending.">
        {(teams ?? []).map((t: any) => {
          const docs = docMap[t.id] ?? { pending: 0, approved: 0, total: 0 };
          const days = daysPending(t.created_at);
          return (
            <ApplicantRow
              key={t.id}
              href={`/admin-management/approvals/team/${t.id}`}
              type="Team"
              typeTone="emerald"
              title={t.display_name ?? '2-person crew'}
              status={t.onboarding_status}
              subtitle={`Code ${t.invite_code}`}
              docsTotal={docs.total}
              docsPending={docs.pending}
              docsApproved={docs.approved}
              daysPending={days}
              createdAt={t.created_at}
            />
          );
        })}
      </Section>

      {/* Companies */}
      <Section title="Moving companies" count={companies?.length ?? 0} empty="No company applications pending.">
        {(companies ?? []).map((c: any) => {
          const docs = docMap[c.id] ?? { pending: 0, approved: 0, total: 0 };
          const days = daysPending(c.created_at);
          return (
            <ApplicantRow
              key={c.id}
              href={`/admin-management/approvals/company/${c.id}`}
              type="Company"
              typeTone="zinc"
              title={c.display_name ?? c.legal_name}
              status={c.onboarding_status}
              subtitle={c.registration_number ?? `Code ${c.invite_code}`}
              docsTotal={docs.total}
              docsPending={docs.pending}
              docsApproved={docs.approved}
              daysPending={days}
              createdAt={c.created_at}
            />
          );
        })}
      </Section>

    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({
  title, count, empty, children,
}: {
  title: string; count: number; empty: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        <span className="px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold">{count}</span>
      </div>
      {count === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed px-5 py-6 text-sm text-zinc-500 text-center">
          {empty}
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
          {children}
        </div>
      )}
    </div>
  );
}

// ── ApplicantRow ──────────────────────────────────────────────────────────────
function ApplicantRow({
  href, type, typeTone, title, status, subtitle,
  docsTotal, docsPending, docsApproved, daysPending, createdAt,
}: {
  href: string;
  type: string;
  typeTone: 'emerald' | 'zinc';
  title: string;
  status: string;
  subtitle: string;
  docsTotal: number;
  docsPending: number;
  docsApproved: number;
  daysPending: number;
  createdAt: string;
}) {
  const isStale = daysPending > 7;
  const statusColor =
    status === 'in_review' ? 'bg-blue-50 text-blue-700'
    : status === 'docs_uploaded' ? 'bg-emerald-50 text-emerald-700'
    : 'bg-amber-50 text-amber-700';

  return (
    <Link href={href} className="flex items-center px-5 py-4 hover:bg-zinc-50 transition-colors gap-4">
      {/* Avatar */}
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold shrink-0 ${
        typeTone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
      }`}>
        {type[0]}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-bold text-zinc-900 truncate">{title}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>
            {fmtStatus(status)}
          </span>
          {isStale && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-bold">
              {daysPending}d pending
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500">{subtitle}</div>
        {docsTotal > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-400">
              {docsTotal} doc{docsTotal !== 1 ? 's' : ''}
            </span>
            {docsApproved > 0 && <span className="text-xs text-emerald-600">{docsApproved} approved</span>}
            {docsPending > 0 && <span className="text-xs text-amber-600">{docsPending} pending review</span>}
          </div>
        )}
      </div>

      {/* Time + arrow */}
      <div className="text-right shrink-0">
        <div className="text-xs text-zinc-400 whitespace-nowrap">{fmtRelative(createdAt)}</div>
        {!isStale && daysPending > 0 && (
          <div className="text-xs text-zinc-400 mt-0.5">{daysPending}d ago</div>
        )}
      </div>
      <svg className="h-4 w-4 text-zinc-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
