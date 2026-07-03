'use client';

// =============================================================================
// PinGate — the 6-digit unlock screen shown before revenue renders.
//
// Also hosts the "Set a PIN" (first time) / "Change PIN" panel so management
// can rotate the code without leaving the screen. All verification is
// server-side (admin-console edge fn); this component only collects digits.
// =============================================================================

import { useActionState, useState } from 'react';
import { unlockRevenue, changePin, type PinState } from './actions';

export function PinGate({ pinIsSet }: { pinIsSet: boolean }) {
  const [unlockState, unlockAction, unlocking] = useActionState<PinState, FormData>(unlockRevenue, {});
  const [showChange, setShowChange] = useState(!pinIsSet);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-zinc-900">Revenue is locked</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {pinIsSet ? 'Enter the 6-digit revenue PIN to continue.' : 'No PIN set yet — set one to protect this screen.'}
          </p>
        </div>

        {pinIsSet ? (
          <form action={unlockAction} className="space-y-3">
            <input
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              placeholder="••••••"
              className="w-full text-center tracking-[0.5em] text-2xl font-bold rounded-xl border border-zinc-300 bg-white py-3 outline-none focus:border-emerald-500"
            />
            {unlockState.error ? (
              <p className="text-sm text-red-600 text-center">{unlockState.error}</p>
            ) : null}
            <button
              type="submit"
              disabled={unlocking}
              className="w-full rounded-xl bg-emerald-600 text-white font-semibold py-3 hover:bg-emerald-700 disabled:opacity-60"
            >
              {unlocking ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        ) : null}

        <div className="mt-4 text-center">
          <button
            onClick={() => setShowChange((v) => !v)}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-900"
          >
            {showChange ? 'Hide' : pinIsSet ? 'Change PIN' : 'Set a PIN'}
          </button>
        </div>

        {showChange ? <ChangePinPanel pinIsSet={pinIsSet} /> : null}
      </div>
    </div>
  );
}

function ChangePinPanel({ pinIsSet }: { pinIsSet: boolean }) {
  const [state, action, pending] = useActionState<PinState, FormData>(changePin, {});
  return (
    <form action={action} className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      {pinIsSet ? (
        <div>
          <label className="text-xs font-semibold text-zinc-500">Current PIN</label>
          <input
            name="current_pin"
            inputMode="numeric"
            maxLength={6}
            placeholder="Current 6-digit PIN"
            className="mt-1 w-full rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500"
          />
        </div>
      ) : null}
      <div>
        <label className="text-xs font-semibold text-zinc-500">New PIN</label>
        <input
          name="new_pin"
          inputMode="numeric"
          maxLength={6}
          placeholder="New 6-digit PIN"
          className="mt-1 w-full rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500"
        />
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700">PIN updated — enter it above to unlock.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-900 text-white text-sm font-semibold py-2.5 hover:bg-zinc-800 disabled:opacity-60"
      >
        {pending ? 'Saving…' : pinIsSet ? 'Change PIN' : 'Set PIN'}
      </button>
    </form>
  );
}
