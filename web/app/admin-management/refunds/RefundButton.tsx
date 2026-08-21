'use client';

// =============================================================================
// RefundButton — issue one owed refund, with a confirm step.
//
// Two taps rather than one. This moves real money to a real card and cannot be
// undone from here, and the list it sits in can have several near-identical
// rows for the same customer — exactly the shape where a single misplaced click
// refunds the wrong move.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { issueOwedRefund } from './actions';

export function RefundButton({
  bookingId,
  amount,
  shortCode,
  customer,
}: {
  bookingId: string;
  amount: string;
  shortCode: string;
  customer: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const go = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('booking_id', bookingId);
      const res = await issueOwedRefund({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(res.ok ?? 'Refunded.');
      setConfirming(false);
      router.refresh();
    });
  };

  if (done) {
    return <p className="text-xs font-semibold text-emerald-700">{done}</p>;
  }

  if (!confirming) {
    return (
      <div className="text-right">
        <button
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Refund {amount}
        </button>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className="mb-1.5 text-xs text-zinc-600">
        Send <span className="font-semibold">{amount}</span> back to {customer} for {shortCode}?
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          onClick={go}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Yes, refund'}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
