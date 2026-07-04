'use client';

// =============================================================================
// TeamManager — invite form + employee rows with level / block / remove.
// =============================================================================

import { useActionState } from 'react';
import { inviteMember, setMemberBlocked, setMemberLevel, removeMember, type TeamState } from './actions';

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  access_level: 'management' | 'staff';
  blocked: boolean;
  isRoot: boolean;
}

export function TeamManager({ members }: { members: Member[] }) {
  const [state, action, pending] = useActionState<TeamState, FormData>(inviteMember, {});

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <form action={action} className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="text-sm font-semibold text-zinc-900 mb-3">Add an employee</div>
        <div className="grid sm:grid-cols-4 gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="employee@movvy.ca"
            className="sm:col-span-2 rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500"
          />
          <input
            name="full_name"
            placeholder="Full name (optional)"
            className="rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500"
          />
          <select
            name="access_level"
            defaultValue="staff"
            className="rounded-lg border border-zinc-300 py-2 px-3 text-sm outline-none focus:border-emerald-500 bg-white"
          >
            <option value="staff">Staff (no revenue)</option>
            <option value="management">Management (full)</option>
          </select>
        </div>
        {state.error ? <p className="text-sm text-red-600 mt-2">{state.error}</p> : null}
        {state.ok ? <p className="text-sm text-emerald-700 mt-2">{state.ok}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold px-4 py-2 hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Send invite'}
        </button>
      </form>

      {/* Member list */}
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
              <th className="px-5 py-2.5 font-semibold">Employee</th>
              <th className="px-5 py-2.5 font-semibold">Access</th>
              <th className="px-5 py-2.5 font-semibold">Status</th>
              <th className="px-5 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-zinc-50 last:border-0">
                <td className="px-5 py-3">
                  <div className="font-semibold text-zinc-900">{m.full_name ?? m.email}</div>
                  {m.full_name ? <div className="text-xs text-zinc-400">{m.email}</div> : null}
                </td>
                <td className="px-5 py-3">
                  {m.isRoot ? (
                    <span className="text-xs font-bold text-emerald-700">Management · root</span>
                  ) : (
                    <form action={setMemberLevel} className="inline-flex items-center gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <select
                        name="access_level"
                        defaultValue={m.access_level}
                        className="rounded-lg border border-zinc-200 py-1 px-2 text-xs bg-white"
                      >
                        <option value="staff">Staff</option>
                        <option value="management">Management</option>
                      </select>
                      <button className="text-xs font-semibold text-zinc-500 hover:text-zinc-900">Save</button>
                    </form>
                  )}
                </td>
                <td className="px-5 py-3">
                  {m.blocked ? (
                    <span className="text-xs font-bold text-red-600">Blocked</span>
                  ) : (
                    <span className="text-xs font-semibold text-zinc-500">Active</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {m.isRoot ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : (
                    <div className="inline-flex items-center gap-2">
                      <form action={setMemberBlocked} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="blocked" value={String(!m.blocked)} />
                        <button className={`text-xs font-semibold ${m.blocked ? 'text-emerald-700 hover:text-emerald-800' : 'text-amber-700 hover:text-amber-800'}`}>
                          {m.blocked ? 'Unblock' : 'Block'}
                        </button>
                      </form>
                      <form action={removeMember} className="inline">
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
        Blocking keeps their account but denies console access immediately. Staff never see the Revenue screen.
      </p>
    </div>
  );
}
