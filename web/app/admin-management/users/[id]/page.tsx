// =============================================================================
// /admin-management/users/[id] — user detail: profile, move history, moderation.
// =============================================================================

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtStatus, fmtDate } from '@/lib/format';
import { UserActions } from './UserActions';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (!access) redirect('/admin-management/login');
  const isManagement = access === 'management';

  const { data: u } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, is_suspended, suspended_reason, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!u) notFound();

  // Their moves (as a customer). Cap + newest first.
  const { data: moves } = await supabase
    .from('bookings')
    .select('id, short_code, status, pickup_city, dropoff_city, scheduled_for_date, price_total_cents, actual_total_cents')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })
    .limit(25);

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <Link href="/admin-management/users" className="text-xs font-semibold text-zinc-500 hover:text-zinc-900">← Back to users</Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mt-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{u.full_name ?? u.email ?? 'User'}</h1>
          <div className="text-sm text-zinc-500 mt-1">{u.email ?? '—'} · {u.phone ?? '—'}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 capitalize">{String(u.role).replace('_', ' ')}</span>
            {u.is_suspended ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Suspended</span> : null}
            <span className="text-xs text-zinc-400">Joined {new Date(u.created_at).toLocaleDateString('en-CA')}</span>
          </div>
          {u.is_suspended && u.suspended_reason ? (
            <div className="mt-2 text-xs text-red-600">Reason: {u.suspended_reason}</div>
          ) : null}
        </div>
        <UserActions profileId={u.id} isSuspended={!!u.is_suspended} />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-2">Move history</h2>
      {(moves ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No moves.</div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          {(moves ?? []).map((m: any, i: number) => (
            <Link key={m.id} href={`/admin-management/moves/${m.id}`} className={`flex items-center justify-between gap-4 px-5 py-3 hover:bg-zinc-50 ${i > 0 ? 'border-t border-zinc-50' : ''}`}>
              <div className="min-w-0">
                <div className="font-semibold text-zinc-900 text-sm">#{m.short_code} · <span className="font-normal text-zinc-600">{m.pickup_city} → {m.dropoff_city ?? 'in-home'}</span></div>
                <div className="text-xs text-zinc-400">{fmtDate(m.scheduled_for_date)} · {fmtStatus(m.status)}</div>
              </div>
              {isManagement ? <span className="text-sm font-semibold text-zinc-900 shrink-0">{fmtCents(m.actual_total_cents ?? m.price_total_cents)}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
