// =============================================================================
// /admin-management/disputes — open disputes queue.
//
// The console previously only showed dispute COUNTS. This is the actual work
// surface: every open / in-review dispute with its move + parties, linking to
// a resolve screen. Replaces the mobile-only (and Android-broken) flow.
// =============================================================================

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents } from '@/lib/format';

export const dynamic = 'force-dynamic';

const OPEN = ['open', 'in_review'];

export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const showAll = scope === 'all';

  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) redirect('/admin-management/login');

  let q = supabase
    .from('disputes')
    .select('id, booking_id, kind, severity, summary, status, refund_cents, created_at, opened_by')
    .order('created_at', { ascending: false })
    .limit(100);
  if (!showAll) q = q.in('status', OPEN);
  const { data: disputes } = await q;
  const rows = disputes ?? [];

  // Resolve booking codes + opener names in batch.
  const bookingIds = [...new Set(rows.map((d: any) => d.booking_id).filter(Boolean))];
  const openerIds = [...new Set(rows.map((d: any) => d.opened_by).filter(Boolean))];
  const [{ data: bookings }, { data: openers }] = await Promise.all([
    bookingIds.length ? supabase.from('bookings').select('id, short_code').in('id', bookingIds) : Promise.resolve({ data: [] as any[] }),
    openerIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', openerIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const bookingMap = new Map((bookings ?? []).map((b: any) => [b.id, b.short_code]));
  const openerMap = new Map((openers ?? []).map((p: any) => [p.id, p.full_name ?? p.email]));

  return (
    <div className="p-6 sm:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Disputes</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/admin-management/disputes" className={`px-3 py-1.5 rounded-lg font-semibold ${!showAll ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>Open</Link>
          <Link href="/admin-management/disputes?scope=all" className={`px-3 py-1.5 rounded-lg font-semibold ${showAll ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>All</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500">
          {showAll ? 'No disputes on record.' : 'No open disputes. 🎉'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d: any) => (
            <Link key={d.id} href={`/admin-management/disputes/${d.id}`} className="block rounded-2xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-emerald-700">#{bookingMap.get(d.booking_id) ?? '—'}</span>
                  <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">{String(d.kind).replace('_', ' ')}</span>
                  <SeverityBadge severity={d.severity} />
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d.status === 'open' ? 'bg-amber-100 text-amber-700' : d.status === 'in_review' ? 'bg-blue-100 text-blue-700' : 'bg-zinc-100 text-zinc-500'}`}>{String(d.status).replace('_', ' ')}</span>
                </div>
                {d.refund_cents > 0 ? <span className="text-xs font-semibold text-zinc-500">Refunded {fmtCents(d.refund_cents)}</span> : null}
              </div>
              <p className="mt-2 text-sm text-zinc-800 line-clamp-2">{d.summary}</p>
              <p className="mt-1 text-xs text-zinc-400">Opened by {openerMap.get(d.opened_by) ?? 'unknown'} · {new Date(d.created_at).toLocaleDateString('en-CA')}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-zinc-100 text-zinc-600',
  };
  return <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${map[severity] ?? map.low}`}>{severity}</span>;
}
