'use client';

// =============================================================================
// PayoutActions — mark a withdrawal paid, or send it back.
//
// Both paths demand a sentence: a payment needs a reference so it can be traced
// to a confirmation number later, a rejection needs a reason so the crew knows
// what to fix. Neither is optional, because a crew staring at "rejected" with
// no explanation will just call you.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decidePayout } from './actions';

export function PayoutActions({ id, amount }: { id: string; amount: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'paid' | 'rejected'>('idle');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (mode === 'idle') return;
    setError(null);
    startTransition(async () => {
      const res = await decidePayout(id, mode, detail);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setMode('idle');
      setDetail('');
      router.refresh();
    });
  };

  if (mode === 'idle') {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => setMode('paid')}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Mark {amount} sent
        </button>
        <button
          onClick={() => setMode('rejected')}
          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <div>
      <textarea
        autoFocus
        rows={2}
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder={
          mode === 'paid'
            ? 'e-Transfer confirmation number or wire reference'
            : "Why it's being sent back — the crew sees this"
        }
        className="w-full rounded-lg border border-zinc-200 p-2 text-xs text-zinc-900 focus:border-emerald-500 focus:outline-none"
      />
      <div className="mt-2 flex gap-2">
        <button
          disabled={pending || detail.trim().length < 3}
          onClick={submit}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
            mode === 'paid' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {pending ? 'Saving…' : mode === 'paid' ? `Confirm ${amount} sent` : 'Send back'}
        </button>
        <button
          disabled={pending}
          onClick={() => { setMode('idle'); setDetail(''); setError(null); }}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
