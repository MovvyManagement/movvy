// =============================================================================
// /admin-management/users — user lookup + moderation.
//
// The console's first real SEARCH surface: find any customer or partner by
// email, name, or phone, then open them to see history + suspend/reinstate.
// =============================================================================

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  customer: 'Customer', driver: 'Driver', mover: 'Mover',
  company_owner: 'Company owner', movvy_admin: 'Admin', movvy_support: 'Support',
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) redirect('/admin-management/login');

  let results: any[] = [];
  if (query.length >= 2) {
    // Escape PostgREST or() special chars in the user input before interpolation.
    const safe = query.replace(/[,()*]/g, ' ');
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, is_suspended, created_at')
      .or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order('created_at', { ascending: false })
      .limit(40);
    results = data ?? [];
  }

  return (
    <div className="p-6 sm:p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Users</h1>
      <p className="text-sm text-zinc-500 mb-5">Search by email, name, or phone.</p>

      <form className="mb-6">
        <div className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="jane@example.com · Jane Doe · +1403…"
            className="flex-1 rounded-xl border border-zinc-300 py-2.5 px-4 text-sm outline-none focus:border-emerald-500"
          />
          <button className="rounded-xl bg-zinc-900 text-white text-sm font-semibold px-5 hover:bg-zinc-800">Search</button>
        </div>
      </form>

      {query.length >= 2 ? (
        results.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
            No users match “{query}”.
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            {results.map((u, i) => (
              <Link key={u.id} href={`/admin-management/users/${u.id}`} className={`flex items-center justify-between gap-4 px-5 py-3 hover:bg-zinc-50 ${i > 0 ? 'border-t border-zinc-50' : ''}`}>
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-900 truncate">{u.full_name ?? u.email ?? u.phone}</div>
                  <div className="text-xs text-zinc-400 truncate">{u.email ?? '—'} · {u.phone ?? '—'}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.is_suspended ? <span className="text-xs font-bold text-red-600">Suspended</span> : null}
                  <span className="text-xs font-semibold text-zinc-500">{ROLE_LABEL[u.role] ?? u.role}</span>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-zinc-400">Type at least 2 characters to search.</p>
      )}
    </div>
  );
}
