'use client';

// =============================================================================
// MoveActions — reassign crew + cancel (full refund) for one booking.
// Cancel is only rendered for management (it issues a refund).
// =============================================================================

import { useActionState, useState } from 'react';
import { reassignMove, cancelMove, type MoveActionState } from './actions';

interface CrewOption { value: string; label: string }

export function MoveActions({
  bookingId,
  crewOptions,
  canCancel,
  isTerminal,
}: {
  bookingId: string;
  crewOptions: CrewOption[];
  canCancel: boolean;
  isTerminal: boolean;
}) {
  const [reassignState, reassignAction, reassigning] = useActionState<MoveActionState, FormData>(reassignMove, {});
  const [cancelState, cancelAction, cancelling] = useActionState<MoveActionState, FormData>(cancelMove, {});
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (isTerminal) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        This move is completed or cancelled — no further actions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Reassign */}
      <form action={reassignAction} className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-semibold text-zinc-900 mb-2">Reassign crew</div>
        <input type="hidden" name="booking_id" value={bookingId} />
        <div className="flex flex-col sm:flex-row gap-2">
          <select name="target" defaultValue="" className="flex-1 rounded-lg border border-zinc-300 py-2 px-3 text-sm bg-white outline-none focus:border-emerald-500">
            <option value="" disabled>Choose a verified crew…</option>
            {crewOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input name="reason" placeholder="Reason (optional)" className="flex-1 rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500" />
          <button disabled={reassigning} className="rounded-lg bg-zinc-900 text-white text-sm font-semibold px-4 py-2 hover:bg-zinc-800 disabled:opacity-60">
            {reassigning ? 'Reassigning…' : 'Reassign'}
          </button>
        </div>
        {reassignState.error ? <p className="text-sm text-red-600 mt-2">{reassignState.error}</p> : null}
        {reassignState.ok ? <p className="text-sm text-emerald-700 mt-2">{reassignState.ok}</p> : null}
      </form>

      {/* Cancel — management only */}
      {canCancel ? (
        <form action={cancelAction} className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-800 mb-2">Cancel move (full refund)</div>
          <input type="hidden" name="booking_id" value={bookingId} />
          {!confirmCancel ? (
            <button type="button" onClick={() => setConfirmCancel(true)} className="rounded-lg border border-red-300 text-red-700 text-sm font-semibold px-4 py-2 hover:bg-red-100">
              Cancel this move…
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <input name="reason" required placeholder="Reason (customer sees this)" className="flex-1 rounded-lg border border-red-300 py-2 px-3 text-sm outline-none focus:border-red-500" />
              <button disabled={cancelling} className="rounded-lg bg-red-600 text-white text-sm font-semibold px-4 py-2 hover:bg-red-700 disabled:opacity-60">
                {cancelling ? 'Cancelling…' : 'Confirm cancel + refund'}
              </button>
              <button type="button" onClick={() => setConfirmCancel(false)} className="text-sm text-zinc-500 px-2">Keep</button>
            </div>
          )}
          {cancelState.error ? <p className="text-sm text-red-700 mt-2">{cancelState.error}</p> : null}
          {cancelState.ok ? <p className="text-sm text-emerald-700 mt-2">{cancelState.ok}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
