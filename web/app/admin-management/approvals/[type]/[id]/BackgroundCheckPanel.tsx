// =============================================================================
// BackgroundCheckPanel — client island for managing the partner's background
// check on the applicant detail page. Calls admin-set-background-check.
//
// Status semantics:
//   consent_pending → admin sent the consent form, waiting on signature
//   in_progress     → check submitted to provider (CPIC, driver abstract, etc.)
//   passed          → clean result, partner is clearable to approve
//   flagged         → has hits — needs human review before approve/reject
//   failed          → disqualifying result, partner should be rejected
//
// Background check is REQUIRED before approval. The Approve button in the
// sibling DecisionPanel will warn if status !== 'passed'.
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Status =
  | 'consent_pending'
  | 'in_progress'
  | 'passed'
  | 'flagged'
  | 'failed'
  | 'expired'
  | null;

interface ExistingCheck {
  id: string;
  status: Status;
  provider: string;
  provider_ref: string | null;
  consent_signed_at: string | null;
  requested_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  result_summary: string | null;
  result_document_url: string | null;
  notes: string | null;
  hit_count: number | null;
}

const STATUS_META: Record<
  Exclude<Status, null>,
  { label: string; tone: 'amber' | 'blue' | 'emerald' | 'orange' | 'red' | 'zinc' }
> = {
  consent_pending: { label: 'Consent pending', tone: 'amber' },
  in_progress:     { label: 'Check in progress', tone: 'blue' },
  passed:          { label: 'Passed', tone: 'emerald' },
  flagged:         { label: 'Flagged — review', tone: 'orange' },
  failed:          { label: 'Failed', tone: 'red' },
  expired:         { label: 'Expired — re-run needed', tone: 'zinc' },
};

const TONE_CLASSES: Record<string, string> = {
  amber:   'bg-amber-100 text-amber-700',
  blue:    'bg-blue-100 text-blue-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  orange:  'bg-orange-100 text-orange-700',
  red:     'bg-red-100 text-red-700',
  zinc:    'bg-zinc-100 text-zinc-700',
};

export function BackgroundCheckPanel({
  subjectType,
  subjectId,
  existing,
}: {
  subjectType: 'team' | 'company';
  subjectId: string;
  existing: ExistingCheck | null;
}) {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState<Status>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: Exclude<Status, null>) {
    setBusy(next);
    setError(null);
    try {
      let summary: string | undefined;
      let notes: string | undefined;
      if (next === 'flagged' || next === 'failed') {
        const reason = window.prompt(
          next === 'failed'
            ? 'What disqualified them? (becomes the result summary)'
            : 'What was flagged? (becomes the result summary)',
        );
        if (!reason?.trim()) {
          setBusy(null);
          return;
        }
        summary = reason.trim();
      } else if (next === 'passed') {
        notes = window.prompt('Optional notes:') ?? undefined;
      }
      const { data, error: invErr } = await supabase.functions.invoke(
        'admin-set-background-check',
        {
          body: {
            check_id: existing?.id,
            subject_type: subjectType,
            subject_id: subjectId,
            status: next,
            provider: existing?.provider ?? 'manual',
            result_summary: summary,
            notes,
          },
        },
      );
      if (invErr) throw invErr;
      if ((data as any)?.error) throw new Error((data as any).error);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const status = existing?.status ?? null;
  const meta = status ? STATUS_META[status] : null;

  return (
    <section className="mb-8 rounded-2xl bg-white border border-zinc-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </span>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Background check</h2>
            <p className="text-xs text-zinc-500">
              CPIC + driver abstract · required before approval
            </p>
          </div>
        </div>
        {meta ? (
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold ${TONE_CLASSES[meta.tone]}`}
          >
            {meta.label}
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-100 text-zinc-700">
            Not started
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        {existing ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <Field label="Provider" value={existing.provider ?? '—'} />
            <Field
              label="Provider ref"
              value={existing.provider_ref ?? '—'}
            />
            <Field
              label="Consent signed"
              value={fmtDate(existing.consent_signed_at)}
            />
            <Field
              label="Submitted"
              value={fmtDate(existing.requested_at)}
            />
            <Field
              label="Completed"
              value={fmtDate(existing.completed_at)}
            />
            <Field
              label="Expires"
              value={fmtDate(existing.expires_at)}
            />
            {existing.result_summary ? (
              <Field
                label="Summary"
                value={existing.result_summary}
                fullWidth
              />
            ) : null}
            {existing.notes ? (
              <Field label="Notes" value={existing.notes} fullWidth />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No background check on file. Start the manual process by following the
            runbook in <code className="px-1 bg-zinc-100 rounded text-[11px]">docs/background-checks/RUNBOOK.md</code>,
            then mark progress here as it advances.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-100">
          <ActionButton
            label="Mark consent received"
            onClick={() => setStatus('consent_pending')}
            busy={busy === 'consent_pending'}
            disabled={busy !== null || status === 'consent_pending'}
            tone="zinc"
          />
          <ActionButton
            label="Mark check in progress"
            onClick={() => setStatus('in_progress')}
            busy={busy === 'in_progress'}
            disabled={busy !== null || status === 'in_progress'}
            tone="blue"
          />
          <ActionButton
            label="Mark passed ✓"
            onClick={() => setStatus('passed')}
            busy={busy === 'passed'}
            disabled={busy !== null || status === 'passed'}
            tone="emerald"
          />
          <ActionButton
            label="Flag for review"
            onClick={() => setStatus('flagged')}
            busy={busy === 'flagged'}
            disabled={busy !== null || status === 'flagged'}
            tone="orange"
          />
          <ActionButton
            label="Mark failed"
            onClick={() => setStatus('failed')}
            busy={busy === 'failed'}
            disabled={busy !== null || status === 'failed'}
            tone="red"
          />
        </div>

        {error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="text-sm text-zinc-900">{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone: 'emerald' | 'red' | 'orange' | 'blue' | 'zinc';
}) {
  const toneClasses: Record<string, string> = {
    emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
    red:     'bg-red-600 text-white hover:bg-red-700',
    orange:  'bg-orange-500 text-white hover:bg-orange-600',
    blue:    'bg-blue-600 text-white hover:bg-blue-700',
    zinc:    'bg-zinc-200 text-zinc-900 hover:bg-zinc-300',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${toneClasses[tone]}`}
    >
      {busy ? '…' : label}
    </button>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
