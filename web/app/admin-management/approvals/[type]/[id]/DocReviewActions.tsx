'use client';

// =============================================================================
// DocReviewActions — approve / reject a single uploaded document.
//
// Truck registration in particular is a hard gate: org_can_take_booking() only
// unlocks job acceptance once the registration is APPROVED. Rejecting asks for
// a comment, which the partner sees in their profile so they know what to
// re-upload — otherwise a rejection is a dead end for them.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewDocument } from './actions';

export function DocReviewActions({
  docId,
  status,
  rejectionReason,
}: {
  docId: string;
  status: string;
  rejectionReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState(rejectionReason ?? '');
  const [error, setError] = useState<string | null>(null);

  const run = (decision: 'approved' | 'rejected', note?: string) => {
    setError(null);
    startTransition(async () => {
      const res = await reviewDocument(docId, decision, note ?? null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setRejecting(false);
      router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      {status === 'rejected' && rejectionReason ? (
        <p className="mb-2 text-xs text-red-600">
          <span className="font-semibold">Changes requested:</span> {rejectionReason}
        </p>
      ) : null}

      {rejecting ? (
        <div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="What's wrong with it? e.g. photo is cut off — we need the full registration showing the plate."
            className="w-full rounded-lg border border-zinc-200 p-2 text-xs text-zinc-900 focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={pending || comment.trim().length < 3}
              onClick={() => run('rejected', comment.trim())}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Send request'}
            </button>
            <button
              disabled={pending}
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={pending || status === 'approved'}
            onClick={() => run('approved')}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {status === 'approved' ? 'Approved' : pending ? 'Saving…' : 'Approve'}
          </button>
          <button
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40"
          >
            Request changes
          </button>
        </div>
      )}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
