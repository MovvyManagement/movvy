'use client';

import { useState } from 'react';
import { suspendUser } from '../actions';

export function UserActions({ profileId, isSuspended }: { profileId: string; isSuspended: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (isSuspended) {
    return (
      <form action={suspendUser} className="inline">
        <input type="hidden" name="profile_id" value={profileId} />
        <input type="hidden" name="action" value="reinstate" />
        <button className="rounded-lg bg-emerald-600 text-white text-sm font-semibold px-4 py-2 hover:bg-emerald-700">
          Reinstate user
        </button>
      </form>
    );
  }

  return !confirming ? (
    <button onClick={() => setConfirming(true)} className="rounded-lg border border-red-300 text-red-700 text-sm font-semibold px-4 py-2 hover:bg-red-50">
      Suspend user…
    </button>
  ) : (
    <form action={suspendUser} className="flex flex-col sm:flex-row gap-2">
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="action" value="suspend" />
      <input name="reason" placeholder="Reason (audit log)" className="flex-1 rounded-lg border border-red-300 py-2 px-3 text-sm outline-none focus:border-red-500" />
      <button className="rounded-lg bg-red-600 text-white text-sm font-semibold px-4 py-2 hover:bg-red-700">Confirm suspend</button>
      <button type="button" onClick={() => setConfirming(false)} className="text-sm text-zinc-500 px-2">Cancel</button>
    </form>
  );
}
