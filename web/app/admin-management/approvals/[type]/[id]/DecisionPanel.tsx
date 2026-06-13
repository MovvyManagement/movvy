// =============================================================================
// DecisionPanel — client island for Approve / Reject on the applicant
// detail page. Calls supabase.functions.invoke('admin-verify-partner')
// which is the same edge function the mobile admin uses, so server-side
// rules (full-admin role for approvals, audit logging, document status
// updates) are exactly the same.
//
// Lives next to its only consumer to keep the import surface tiny. Reads
// the browser Supabase client because invoking edge functions needs the
// session JWT in cookies, which the browser client picks up automatically.
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function DecisionPanel({
  subjectType,
  subjectId,
}: {
  subjectType: 'team' | 'company';
  subjectId: string;
}) {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(null);
    try {
      const notes =
        decision === 'reject'
          ? window.prompt('Reason (shown to applicant):') ?? ''
          : window.prompt('Optional notes:') ?? undefined;
      if (decision === 'reject' && !notes?.trim()) {
        setError('Rejection requires a reason.');
        setBusy(null);
        return;
      }
      const { data, error: invErr } = await supabase.functions.invoke(
        'admin-verify-partner',
        {
          body: {
            subject_type: subjectType,
            subject_id: subjectId,
            decision,
            notes: notes?.trim() || undefined,
          },
        },
      );
      if (invErr) throw invErr;
      if ((data as any)?.error) throw new Error((data as any).error);

      // Force a server re-render so the status badge flips and the
      // decision panel disappears.
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => decide('reject')}
          disabled={!!busy}
          className="h-10 px-5 rounded-2xl bg-zinc-100 text-zinc-900 text-sm font-bold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          onClick={() => decide('approve')}
          disabled={!!busy}
          className="h-10 px-5 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
      {error ? (
        <div className="text-xs text-red-600 max-w-xs text-right">{error}</div>
      ) : null}
    </div>
  );
}
