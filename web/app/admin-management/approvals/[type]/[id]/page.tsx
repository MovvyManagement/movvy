// =============================================================================
// /admin-management/approvals/[type]/[id]
//
// Applicant detail. Renders every verification document tied to the
// team / company (and, for teams, to each member profile) with a
// short-lived signed Storage URL so the admin can actually SEE the
// uploaded ID / license / insurance instead of just metadata.
//
// Approve / Reject buttons call the admin-verify-partner edge function,
// which flips onboarding_status to verified|rejected + marks the
// documents.status to match. The buttons live in a client component
// (`DecisionPanel`) so the spinner state can re-render without a full
// server round-trip.
// =============================================================================

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDateTime, fmtStatus } from '@/lib/format';
import { DecisionPanel } from './DecisionPanel';
import { DocReviewActions } from './DocReviewActions';
import { BackgroundCheckPanel } from './BackgroundCheckPanel';

export const dynamic = 'force-dynamic';

const DOC_LABELS: Record<string, string> = {
  gov_id: 'Government ID',
  driver_license: 'Driver license',
  insurance: 'Vehicle insurance',
  business_registration: 'Business registration',
  selfie_with_id: 'Selfie with ID',
};

interface PageProps {
  params: Promise<{ type: string; id: string }>;
}

// Route params are attacker-controllable and `id` gets interpolated into a
// PostgREST .or() filter below, so reject anything that isn't a plain UUID
// before it reaches a query. A malformed id is a 404, not a filter to smuggle.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ApplicantDetailPage({ params }: PageProps) {
  const { type, id } = await params;
  if (type !== 'team' && type !== 'company') notFound();
  if (!UUID_RE.test(id)) notFound();

  const supabase = await supabaseServer();

  // Subject row — different tables, same shape for our purposes.
  let subject:
    | {
        id: string;
        name: string;
        subtitle: string;
        onboarding_status: string;
        created_at: string;
        invite_code?: string;
      }
    | null = null;

  // Doc + member fetch happens per-subject because team docs span both
  // the team row AND every member profile, while company docs are all
  // scoped to the company.
  let docs: any[] = [];
  let members: any[] = [];

  if (type === 'team') {
    const [{ data: team }, { data: ms }] = await Promise.all([
      supabase
        .from('partner_teams')
        .select(
          'id, display_name, primary_city_id, onboarding_status, created_at, invite_code',
        )
        .eq('id', id)
        .single(),
      supabase
        .from('partner_team_members')
        .select('profile_id, role, driver_license_number, profiles(full_name, email, phone)')
        .eq('team_id', id),
    ]);
    if (!team) notFound();

    subject = {
      id: team.id,
      name: team.display_name ?? '2-person crew',
      subtitle: `Team · code ${team.invite_code ?? '—'}`,
      onboarding_status: team.onboarding_status,
      created_at: team.created_at,
      invite_code: team.invite_code,
    };
    members = ms ?? [];

    const memberIds = members.map((m) => m.profile_id).filter(Boolean);
    const { data: vd } = await supabase
      .from('verification_documents')
      .select(
        'id, kind, storage_bucket, storage_path, status, rejection_reason, mime_type, expires_at, created_at, profile_id, team_id',
      )
      .or(`team_id.eq.${id},profile_id.in.(${memberIds.join(',') || '00000000-0000-0000-0000-000000000000'})`)
      .order('created_at', { ascending: false });
    docs = vd ?? [];
  } else {
    const { data: company } = await supabase
      .from('companies')
      .select(
        'id, legal_name, display_name, registration_number, onboarding_status, created_at, invite_code, hq_line1, hq_city_name, hq_region, phone, email',
      )
      .eq('id', id)
      .single();
    if (!company) notFound();

    subject = {
      id: company.id,
      name: company.display_name ?? company.legal_name,
      subtitle: [
        company.registration_number ? `Reg ${company.registration_number}` : 'Independent operator',
        company.hq_city_name ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
      onboarding_status: company.onboarding_status,
      created_at: company.created_at,
      invite_code: company.invite_code,
    };

    // Operator onboarding uploads the driver's licence + government ID against
    // the PERSON (subject_type 'profile'), not the org — so a company-only
    // filter showed an empty doc list for every app signup and left admins with
    // nothing to review. Include the org's members' personal docs too, the same
    // way the team branch above does.
    const { data: cMembers } = await supabase
      .from('company_members')
      .select('profile_id')
      .eq('company_id', id)
      .is('removed_at', null);
    const cMemberIds = (cMembers ?? []).map((m: any) => m.profile_id).filter(Boolean);

    const { data: vd } = await supabase
      .from('verification_documents')
      .select(
        'id, kind, storage_bucket, storage_path, status, rejection_reason, mime_type, expires_at, created_at, company_id, profile_id',
      )
      .or(
        `company_id.eq.${id},profile_id.in.(${
          cMemberIds.join(',') || '00000000-0000-0000-0000-000000000000'
        })`,
      )
      .order('created_at', { ascending: false });
    docs = vd ?? [];
  }

  // Sign Storage URLs in parallel — each one is valid for 15 minutes.
  // That's enough time to review without leaking long-lived links if
  // the admin accidentally pastes one into Slack.
  const signed = await Promise.all(
    docs.map(async (d) => {
      const { data } = await supabase.storage
        .from(d.storage_bucket)
        .createSignedUrl(d.storage_path, 60 * 15);
      return { ...d, signed_url: data?.signedUrl ?? null };
    }),
  );

  // Latest background check for this subject — drives the BackgroundCheckPanel.
  const { data: bgCheck } = await supabase
    .from('background_checks')
    .select(
      'id, status, provider, provider_ref, consent_signed_at, requested_at, completed_at, expires_at, result_summary, result_document_url, notes, hit_count',
    )
    .eq('subject_type', type)
    .eq('subject_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const finalStatus =
    subject!.onboarding_status === 'verified' ||
    subject!.onboarding_status === 'rejected';

  const bgPassed = bgCheck?.status === 'passed';

  return (
    <div className="px-8 py-8 max-w-6xl">
      <Link
        href="/admin-management/approvals"
        className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-900 mb-6"
      >
        ← Back to queue
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{subject!.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">{subject!.subtitle}</p>
          <p className="text-xs text-zinc-400 mt-1">
            Submitted {fmtDateTime(subject!.created_at)} · current status:{' '}
            <span className="font-semibold text-zinc-700">
              {fmtStatus(subject!.onboarding_status)}
            </span>
          </p>
        </div>

        {/* Decision controls — client island */}
        {!finalStatus ? (
          <DecisionPanel
            subjectType={type as 'team' | 'company'}
            subjectId={subject!.id}
            backgroundCheckPassed={bgPassed}
          />
        ) : (
          <span
            className={`px-4 py-2 rounded-full text-sm font-semibold ${
              subject!.onboarding_status === 'verified'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            Already {subject!.onboarding_status}
          </span>
        )}
      </div>

      {/* Background check — must be 'passed' before approval */}
      {!finalStatus ? (
        <BackgroundCheckPanel
          subjectType={type as 'team' | 'company'}
          subjectId={subject!.id}
          existing={(bgCheck as any) ?? null}
        />
      ) : null}

      {/* Team members (teams only) */}
      {type === 'team' && members.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Team members
          </h2>
          <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
            {members.map((m: any) => (
              <div
                key={m.profile_id}
                className="flex items-center px-5 py-4 border-b border-zinc-100 last:border-b-0"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${
                    m.role === 'driver'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-200 text-zinc-700'
                  }`}
                >
                  {m.role === 'driver' ? 'D' : 'M'}
                </div>
                <div className="ml-4 flex-1 min-w-0">
                  <div className="text-sm font-bold text-zinc-900">
                    {m.profiles?.full_name ?? '—'}{' '}
                    <span className="ml-2 text-xs font-medium text-zinc-500">
                      {m.role}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {m.profiles?.email ?? m.profiles?.phone ?? 'No contact'}
                    {m.driver_license_number
                      ? ` · License #${m.driver_license_number}`
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Documents */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Documents ({signed.length})
        </h2>
        {signed.length === 0 ? (
          <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-8 text-center">
            <p className="text-sm text-zinc-500">
              No documents uploaded yet. Approval should wait until the
              applicant submits the required IDs and insurance.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {signed.map((d: any) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DocumentCard({ doc }: { doc: any }) {
  const label = DOC_LABELS[doc.kind] ?? doc.kind;
  const isImage = doc.mime_type?.startsWith('image/');
  const isPdf = doc.mime_type === 'application/pdf';
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
      <div className="aspect-[4/3] bg-zinc-100 flex items-center justify-center overflow-hidden">
        {doc.signed_url ? (
          isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doc.signed_url}
              alt={label}
              className="w-full h-full object-contain"
            />
          ) : isPdf ? (
            <iframe src={doc.signed_url} className="w-full h-full" />
          ) : (
            <a
              href={doc.signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-emerald-700 hover:underline"
            >
              Open file ↗
            </a>
          )
        ) : (
          <span className="text-xs text-zinc-500">Could not load file</span>
        )}
      </div>
      <div className="px-4 py-3 border-t border-zinc-100">
        <div className="text-sm font-bold text-zinc-900">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5 flex items-center justify-between">
          <span>{doc.mime_type ?? 'unknown type'}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
              doc.status === 'approved'
                ? 'bg-emerald-100 text-emerald-700'
                : doc.status === 'rejected'
                ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {doc.status}
          </span>
        </div>
        <DocReviewActions
          docId={doc.id}
          status={doc.status}
          rejectionReason={doc.rejection_reason ?? null}
        />
        {doc.signed_url ? (
          <a
            href={doc.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-emerald-700 hover:underline"
          >
            Open full-size ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
