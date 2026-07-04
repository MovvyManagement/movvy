// =============================================================================
// /admin-management/moves/[id] — single move detail + live-incident actions.
//
// The console's action surface for one booking: full route, customer, crew,
// status, money (management-only), and Reassign / Cancel actions wired to the
// existing edge functions. This is where you handle "driver no-showed on #X".
// =============================================================================

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents, fmtStatus, fmtDate } from '@/lib/format';
import { MoveActions } from './MoveActions';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ['completed', 'cancelled', 'failed'];

export default async function MoveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (!access) redirect('/admin-management/login');
  const isManagement = access === 'management';

  const { data: b } = await supabase
    .from('bookings')
    .select('id, short_code, status, move_type, pickup_line1, pickup_city, dropoff_line1, dropoff_city, scheduled_for_date, scheduled_for_window, distance_km, duration_min, actual_hours, price_total_cents, movvy_margin_cents, actual_total_cents, actual_driver_payout_cents, actual_commission_cents, customer_id, assigned_team_id, assigned_company_id, created_at, cancellation_reason')
    .eq('id', id)
    .maybeSingle();
  if (!b) notFound();

  // Customer + current crew names, and the verified-crew list for reassignment.
  const [{ data: customer }, { data: team }, { data: company }, { data: teams }, { data: companies }] = await Promise.all([
    b.customer_id ? supabase.from('profiles').select('full_name, email, phone').eq('id', b.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    b.assigned_team_id ? supabase.from('partner_teams').select('display_name').eq('id', b.assigned_team_id).maybeSingle() : Promise.resolve({ data: null }),
    b.assigned_company_id ? supabase.from('companies').select('display_name').eq('id', b.assigned_company_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('partner_teams').select('id, display_name').eq('onboarding_status', 'verified').limit(100),
    supabase.from('companies').select('id, display_name').eq('onboarding_status', 'verified').limit(100),
  ]);

  const crewName = (team as any)?.display_name ?? (company as any)?.display_name ?? null;
  const crewOptions = [
    ...(teams ?? []).map((t: any) => ({ value: `team:${t.id}`, label: `${t.display_name} (crew)` })),
    ...(companies ?? []).map((c: any) => ({ value: `company:${c.id}`, label: `${c.display_name} (company)` })),
  ];
  const isTerminal = TERMINAL.includes(b.status);

  return (
    <div className="p-6 sm:p-8 max-w-5xl">
      <Link href="/admin-management/moves" className="text-xs font-semibold text-zinc-500 hover:text-zinc-900">← Back to moves</Link>

      <div className="flex flex-wrap items-center gap-3 mt-3 mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Move #{b.short_code}</h1>
        <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700">{fmtStatus(b.status)}</span>
        <span className="text-sm text-zinc-500 capitalize">{String(b.move_type ?? '').replace('_', ' ')}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Card title="Route">
          <Row k="From" v={`${b.pickup_line1 ? b.pickup_line1 + ', ' : ''}${b.pickup_city ?? '—'}`} />
          <Row k="To" v={`${b.dropoff_line1 ? b.dropoff_line1 + ', ' : ''}${b.dropoff_city ?? 'in-home'}`} />
          <Row k="Date" v={`${fmtDate(b.scheduled_for_date)}${b.scheduled_for_window ? ' · ' + b.scheduled_for_window : ''}`} />
          {b.distance_km ? <Row k="Distance" v={`${b.distance_km} km`} /> : null}
          {b.actual_hours ? <Row k="Actual hours" v={`${b.actual_hours}h`} /> : null}
        </Card>
        <Card title="People">
          <Row k="Customer" v={(customer as any)?.full_name ?? '—'} />
          <Row k="Email" v={(customer as any)?.email ?? '—'} />
          <Row k="Phone" v={(customer as any)?.phone ?? '—'} />
          <Row k="Crew" v={crewName ?? 'Unassigned'} />
        </Card>
      </div>

      {isManagement ? (
        <div className="mb-6">
          <Card title="Money">
            <div className="grid grid-cols-3 gap-4">
              <Money label="Move cost" value={fmtCents(b.actual_total_cents ?? b.price_total_cents)} sub={b.actual_total_cents ? 'actual' : 'estimate'} />
              <Money label="Driver payout" value={fmtCents(b.actual_driver_payout_cents ?? ((b.actual_total_cents ?? b.price_total_cents) - (b.actual_commission_cents ?? b.movvy_margin_cents)))} />
              <Money label="Movvy cut" value={fmtCents(b.actual_commission_cents ?? b.movvy_margin_cents)} accent />
            </div>
          </Card>
        </div>
      ) : null}

      {b.cancellation_reason ? (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          Cancellation reason: {b.cancellation_reason}
        </div>
      ) : null}

      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-2">Actions</h2>
      <MoveActions bookingId={b.id} crewOptions={crewOptions} canCancel={isManagement} isTerminal={isTerminal} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-zinc-500">{k}</span>
      <span className="font-medium text-zinc-900 text-right">{v}</span>
    </div>
  );
}
function Money({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-emerald-700' : 'text-zinc-900'}`}>{value}</div>
      {sub ? <div className="text-[11px] text-zinc-400">{sub}</div> : null}
    </div>
  );
}
