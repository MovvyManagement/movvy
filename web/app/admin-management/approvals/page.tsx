// =============================================================================
// /admin-management/approvals — applicant queue.
//
// Lists every partner_teams + companies row currently waiting on admin
// review (onboarding_status ∈ in_progress / docs_uploaded / in_review).
// Tap a row → detail page with all uploaded verification docs.
//
// Anything already verified / rejected stays out of this list — those
// land in the Users directory (built later).
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtRelative, fmtStatus } from '@/lib/format';
import { RealtimeRefresh } from '../_components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const supabase = await supabaseServer();

  // Parallel — teams + companies have separate tables but share the
  // onboarding_status enum, so the filters mirror each other exactly.
  const [{ data: teams }, { data: companies }] = await Promise.all([
    supabase
      .from('partner_teams')
      .select(
        'id, display_name, primary_city_id, onboarding_status, created_at, invite_code',
      )
      .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress'])
      .order('created_at', { ascending: false }),
    supabase
      .from('companies')
      .select(
        'id, legal_name, display_name, primary_city_id, onboarding_status, created_at, invite_code, registration_number',
      )
      .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress'])
      .order('created_at', { ascending: false }),
  ]);

  const total = (teams?.length ?? 0) + (companies?.length ?? 0);

  return (
    <div className="px-8 py-8">
      {/* Live: new applicants pop in the queue as they submit; approving
          one in another tab removes it instantly here. Also watches
          verification_documents so doc-upload progress can hint future UX. */}
      <RealtimeRefresh
        channel="admin-approvals"
        tables={['partner_teams', 'companies', 'verification_documents']}
      />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Approvals</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {total > 0
            ? `${total} applicant${total === 1 ? '' : 's'} awaiting review. Updates live as they submit.`
            : 'No applicants in the queue right now. New applications show up here automatically.'}
        </p>
      </div>

      {/* Teams (2-person crews) */}
      <Section
        title="Two-person crews"
        count={teams?.length ?? 0}
        empty="No teams pending."
      >
        {(teams ?? []).map((t: any) => (
          <ApplicantRow
            key={t.id}
            href={`/admin-management/approvals/team/${t.id}`}
            badge="Team"
            badgeTone="emerald"
            title={t.display_name ?? '2-person crew'}
            subtitle={`Code ${t.invite_code} · status: ${fmtStatus(t.onboarding_status)}`}
            createdAt={t.created_at}
          />
        ))}
      </Section>

      {/* Companies */}
      <Section
        title="Moving companies"
        count={companies?.length ?? 0}
        empty="No companies pending."
      >
        {(companies ?? []).map((c: any) => (
          <ApplicantRow
            key={c.id}
            href={`/admin-management/approvals/company/${c.id}`}
            badge="Company"
            badgeTone="zinc"
            title={c.display_name ?? c.legal_name}
            subtitle={`${c.registration_number ?? '—'} · status: ${fmtStatus(c.onboarding_status)}`}
            createdAt={c.created_at}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
        <span className="px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed px-5 py-6 text-sm text-zinc-500 text-center">
          {empty}
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

function ApplicantRow({
  href,
  badge,
  badgeTone,
  title,
  subtitle,
  createdAt,
}: {
  href: string;
  badge: string;
  badgeTone: 'emerald' | 'zinc';
  title: string;
  subtitle: string;
  createdAt: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center px-5 py-4 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors"
    >
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xs font-bold ${
          badgeTone === 'emerald'
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-zinc-100 text-zinc-700'
        }`}
      >
        {badge[0]}
      </div>
      <div className="ml-4 flex-1 min-w-0">
        <div className="text-sm font-bold text-zinc-900 truncate">{title}</div>
        <div className="text-xs text-zinc-500 truncate mt-0.5">{subtitle}</div>
      </div>
      <div className="text-xs text-zinc-400 ml-3 whitespace-nowrap">
        {fmtRelative(createdAt)}
      </div>
      <svg
        className="ml-3 h-4 w-4 text-zinc-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
