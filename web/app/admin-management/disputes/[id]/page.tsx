// =============================================================================
// /admin-management/disputes/[id] — dispute detail + resolve.
// =============================================================================

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents } from '@/lib/format';
import { ResolveForm } from './ResolveForm';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (!access) redirect('/admin-management/login');

  const { data: d } = await supabase
    .from('disputes')
    .select('id, booking_id, opened_by, against_profile_id, kind, severity, summary, status, resolution_notes, refund_cents, resolved_at, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!d) notFound();

  const [{ data: booking }, { data: opener }] = await Promise.all([
    d.booking_id ? supabase.from('bookings').select('id, short_code, status, pickup_city, dropoff_city, price_total_cents').eq('id', d.booking_id).maybeSingle() : Promise.resolve({ data: null }),
    d.opened_by ? supabase.from('profiles').select('full_name, email, phone').eq('id', d.opened_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const isOpen = d.status === 'open' || d.status === 'in_review';

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <Link href="/admin-management/disputes" className="text-xs font-semibold text-zinc-500 hover:text-zinc-900">← Back to disputes</Link>

      <div className="flex flex-wrap items-center gap-3 mt-3 mb-5">
        <h1 className="text-2xl font-bold text-zinc-900 capitalize">{String(d.kind).replace('_', ' ')} dispute</h1>
        <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">{String(d.status).replace('_', ' ')}</span>
        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${d.severity === 'high' ? 'bg-red-100 text-red-700' : d.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600'}`}>{d.severity}</span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 mb-5 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-zinc-500">Move</span>
          {booking ? (
            <Link href={`/admin-management/moves/${(booking as any).id}`} className="font-semibold text-emerald-700 hover:underline">
              #{(booking as any).short_code} · {(booking as any).pickup_city} → {(booking as any).dropoff_city ?? 'in-home'}
            </Link>
          ) : <span className="text-zinc-400">—</span>}
        </div>
        <div className="flex justify-between gap-4"><span className="text-zinc-500">Opened by</span><span className="font-medium text-zinc-900">{(opener as any)?.full_name ?? (opener as any)?.email ?? '—'}</span></div>
        <div className="flex justify-between gap-4"><span className="text-zinc-500">Opened</span><span className="font-medium text-zinc-900">{new Date(d.created_at).toLocaleString('en-CA')}</span></div>
        <div>
          <div className="text-zinc-500 mb-1">Summary</div>
          <p className="text-zinc-900 whitespace-pre-wrap">{d.summary}</p>
        </div>
      </div>

      {isOpen ? (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-2">Resolve</h2>
          <ResolveForm disputeId={d.id} canRefund={access === 'management'} />
        </>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm">
          <div className="font-semibold text-zinc-900 mb-1">Already resolved</div>
          {d.resolution_notes ? <p className="text-zinc-700 whitespace-pre-wrap">{d.resolution_notes}</p> : null}
          {d.refund_cents > 0 ? <p className="mt-2 text-zinc-600">Refund issued: {fmtCents(d.refund_cents)}</p> : null}
        </div>
      )}
    </div>
  );
}
