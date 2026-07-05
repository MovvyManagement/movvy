'use client';

// =============================================================================
// MoveActions — reassign crew, cancel (full refund), and issue a standalone
// refund for one booking.
// Cancel + refund are only rendered for management (canCancel); reassign is ops.
// =============================================================================

import { useActionState, useState } from 'react';
import { reassignMove, cancelMove, issueRefund, type MoveActionState } from './actions';

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
    const [refundState, refundAction, refunding] = useActionState<MoveActionState, FormData>(issueRefund, {});
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [showRefund, setShowRefund] = useState(false);

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
            <select name="target" defaultValue="" className="flex-1 rounded-lg border border-zinc-300 py-2 px-3 text-sm bg-white outline-none focus:border-zinc-900">
              <option value="" disabled>Choose a verified crew…</option>
  {crewOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button disabled={reassigning} className="rounded-lg bg-zinc-900 text-white text-sm font-semibold px-4 py-2 hover:bg-zinc-800 disabled:opacity-50">
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
               <input name="reason" required placeholder="Reason (customer sees this)" className="flex-1 rounded-lg border border-red-300 py-2 px-3 text-sm bg-white outline-none focus:border-red-600" />
               <button disabled={cancelling} className="rounded-lg bg-red-600 text-white text-sm font-semibold px-4 py-2 hover:bg-red-700 disabled:opacity-50">
 {cancelling ? 'Cancelling…' : 'Confirm cancel + refund'}
               </button>
               <button type="button" onClick={() => setConfirmCancel(false)} className="text-sm text-zinc-500 px-2">Keep</button>
            </div>
          )}
{cancelState.error ? <p className="text-sm text-red-600 mt-2">{cancelState.error}</p> : null}
{cancelState.ok ? <p className="text-sm text-emerald-700 mt-2">{cancelState.ok}</p> : null}
        </form>
      ) : null}

        {/* Standalone refund — management only (does NOT cancel the move) */}
{canCancel ? (
          <form action={refundAction} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800 mb-2">Issue refund (no cancel)</div>
           <input type="hidden" name="booking_id" value={bookingId} />
 {!showRefund ? (
               <button type="button" onClick={() => setShowRefund(true)} className="rounded-lg border border-amber-300 text-amber-800 text-sm font-semibold px-4 py-2 hover:bg-amber-100">
               Refund part of this move…
             </button>
           ) : (
                         <div className="flex flex-col sm:flex-row gap-2">
                           <input name="amount_dollars" type="number" min="0" step="0.01" required placeholder="Amount ($)" className="w-32 rounded-lg border border-amber-300 py-2 px-3 text-sm bg-white outline-none focus:border-amber-600" />
               <input name="reason" placeholder="Reason (internal)" className="flex-1 rounded-lg border border-amber-300 py-2 px-3 text-sm bg-white outline-none focus:border-amber-600" />
               <button disabled={refunding} className="rounded-lg bg-amber-600 text-white text-sm font-semibold px-4 py-2 hover:bg-amber-700 disabled:opacity-50">
 {refunding ? 'Refunding…' : 'Issue refund'}
               </button>
               <button type="button" onClick={() => setShowRefund(false)} className="text-sm text-zinc-500 px-2">Cancel</button>
            </div>
          )}
{refundState.error ? <p className="text-sm text-red-600 mt-2">{refundState.error}</p> : null}
{refundState.ok ? <p className="text-sm text-emerald-700 mt-2">{refundState.ok}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
