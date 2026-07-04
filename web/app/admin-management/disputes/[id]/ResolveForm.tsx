'use client';

import { useActionState } from 'react';
import { resolveDispute, type DisputeState } from '../actions';

export function ResolveForm({ disputeId, canRefund }: { disputeId: string; canRefund: boolean }) {
  const [state, action, pending] = useActionState<DisputeState, FormData>(resolveDispute, {});
  return (
    <form action={action} className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
      <input type="hidden" name="dispute_id" value={disputeId} />
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Outcome</label>
        <select name="resolution" defaultValue="" required className="mt-1 w-full rounded-lg border border-zinc-300 py-2 px-3 text-sm bg-white outline-none focus:border-emerald-500">
          <option value="" disabled>Choose an outcome…</option>
          <option value="resolved_customer">Resolved in customer&apos;s favour</option>
          <option value="resolved_partner">Resolved in partner&apos;s favour</option>
          <option value="closed">Closed (no action)</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Resolution notes</label>
        <textarea name="notes" required rows={4} placeholder="What was decided and why (written to the audit log)…" className="mt-1 w-full rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500" />
      </div>

      {canRefund ? (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Refund (CAD, optional)</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-zinc-400">$</span>
            <input name="refund_dollars" type="number" min="0" step="0.01" placeholder="0.00" className="w-32 rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500" />
            <span className="text-xs text-zinc-400">Leave blank for no refund</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">Refunds are management-only. You can still record an outcome + notes.</p>
      )}

      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button disabled={pending} className="rounded-lg bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 hover:bg-emerald-700 disabled:opacity-60">
        {pending ? 'Resolving…' : 'Resolve dispute'}
      </button>
    </form>
  );
}
