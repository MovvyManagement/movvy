'use client';

import { useActionState, useState } from 'react';
import { createPromo, type PromoState } from './actions';

export function PromoForm() {
  const [state, action, pending] = useActionState<PromoState, FormData>(createPromo, {});
  const [kind, setKind] = useState('percent_off');

  return (
    <form action={action} className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-sm font-semibold text-zinc-900 mb-3">Create a promo code</div>
      <div className="grid sm:grid-cols-4 gap-3">
        <input name="code" placeholder="MOVE50" required className="rounded-lg border border-zinc-300 py-2 px-3 text-sm uppercase outline-none focus:border-emerald-500" />
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-zinc-300 py-2 px-3 text-sm bg-white outline-none focus:border-emerald-500">
          <option value="percent_off">% off</option>
          <option value="amount_off_cents">$ off</option>
          <option value="free_service_fee">Free service fee</option>
        </select>
        {kind !== 'free_service_fee' ? (
          <input name="value" type="number" min="0" step={kind === 'percent_off' ? '1' : '0.01'} placeholder={kind === 'percent_off' ? '50 (%)' : '25.00 ($)'} className="rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500" />
        ) : <input type="hidden" name="value" value="0" />}
        <input name="city_slug" placeholder="City (optional)" className="rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500" />
      </div>
      {state.error ? <p className="text-sm text-red-600 mt-2">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700 mt-2">{state.ok}</p> : null}
      <button disabled={pending} className="mt-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
        {pending ? 'Creating…' : 'Create promo'}
      </button>
    </form>
  );
}
