// =============================================================================
// /admin-management/support/[id] — chat with one customer.
//
// Server-renders the thread metadata + last 100 messages, then hands off
// to <ChatPanel> (client component) which:
//   1. Subscribes to chat_messages via Supabase Realtime, appending new
//      rows as they arrive — so the admin sees the customer typing live.
//   2. Sends new admin replies via the chat-send edge function (which
//      bumps last_message_at on the thread and inserts is_admin=true).
// =============================================================================

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtCents, fmtStatus } from '@/lib/format';
import { ChatPanel } from './ChatPanel';

export const dynamic = 'force-dynamic';

// In-flight statuses — a move the crew is actively working right now. Kept in
// sync with the Moves page so the support context matches the ops view.
const ACTIVE_STATUSES = [
  'assigned', 'confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading',
];
const UPCOMING_STATUSES = ['pending', 'searching', 'assigned', 'confirmed'];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SupportThreadPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: thread } = await supabase
    .from('chat_threads')
    .select(
      'id, kind, customer_profile_id, last_message_at, created_at, customer:profiles!chat_threads_customer_profile_id_fkey(full_name, email, phone, created_at)',
    )
    .eq('id', id)
    .single();

  if (!thread || thread.kind !== 'support') notFound();

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, body, is_admin, sender_profile_id, created_at')
    .eq('thread_id', id)
    .order('created_at', { ascending: true })
    .limit(100);

  const customer = (thread as any).customer;

  // Move context — so the agent knows what the customer is talking about
  // without asking. Priority: an in-flight move first, else the next upcoming
  // one. Plus a lifetime move count for quick "new vs regular" read.
  const moveSelect =
    'id, short_code, status, pickup_city, dropoff_city, scheduled_for_date, scheduled_for_window, price_total_cents, actual_total_cents, assigned_team_id, assigned_company_id';
  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ data: activeMove }, { data: upcomingMove }, { count: totalMoves }] = await Promise.all([
    supabase
      .from('bookings')
      .select(moveSelect)
      .eq('customer_id', thread.customer_profile_id)
      .in('status', ACTIVE_STATUSES)
      .order('scheduled_for_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('bookings')
      .select(moveSelect)
      .eq('customer_id', thread.customer_profile_id)
      .in('status', UPCOMING_STATUSES)
      .gte('scheduled_for_date', todayIso)
      .order('scheduled_for_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', thread.customer_profile_id),
  ]);

  const move = (activeMove as any) ?? (upcomingMove as any) ?? null;
  const moveIsActive = !!activeMove;

  // Resolve the assigned crew's name for the move, if any.
  let crewName: string | null = null;
  if (move?.assigned_team_id) {
    const { data } = await supabase
      .from('partner_teams').select('display_name').eq('id', move.assigned_team_id).maybeSingle();
    crewName = (data as any)?.display_name ?? null;
  } else if (move?.assigned_company_id) {
    const { data } = await supabase
      .from('companies').select('display_name').eq('id', move.assigned_company_id).maybeSingle();
    crewName = (data as any)?.display_name ?? null;
  }

  return (
    <div className="flex h-screen">
      {/* Customer sidebar */}
      <div className="w-72 border-r border-zinc-200 bg-white px-5 py-6 flex flex-col">
        <Link
          href="/admin-management/support"
          className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 mb-4"
        >
          ← Back to inbox
        </Link>

        <div className="w-14 h-14 rounded-full bg-zinc-200 flex items-center justify-center text-lg font-bold text-zinc-700 mb-3">
          {(customer?.full_name ?? customer?.email ?? '?')[0]?.toUpperCase()}
        </div>
        <div className="text-base font-bold text-zinc-900">
          {customer?.full_name ?? 'Customer'}
        </div>

        <dl className="mt-4 space-y-3 text-xs">
          <Field label="Email" value={customer?.email ?? '—'} />
          <Field label="Phone" value={customer?.phone ?? '—'} />
          <Field
            label="Customer since"
            value={
              customer?.created_at
                ? new Date(customer.created_at).toLocaleDateString('en-CA')
                : '—'
            }
          />
          <Field
            label="Thread opened"
            value={new Date(thread.created_at).toLocaleDateString('en-CA')}
          />
          <Field label="Lifetime moves" value={String(totalMoves ?? 0)} />
        </dl>

        {/* Move context — what the customer is most likely messaging about. */}
        <div className="mt-5 pt-4 border-t border-zinc-100">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
            {moveIsActive ? 'Current move' : move ? 'Upcoming move' : 'Move'}
          </div>
          {move ? (
            <Link
              href="/admin-management/moves"
              className="block rounded-xl border border-zinc-200 bg-zinc-50 p-3 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-900">#{move.short_code}</span>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    moveIsActive
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {fmtStatus(move.status)}
                </span>
              </div>
              <div className="mt-1.5 text-xs text-zinc-700">
                {move.pickup_city ?? '—'} → {move.dropoff_city ?? 'in-home'}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {move.scheduled_for_date
                  ? new Date(move.scheduled_for_date + 'T00:00:00').toLocaleDateString('en-CA', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })
                  : '—'}
                {move.scheduled_for_window ? ` · ${move.scheduled_for_window}` : ''}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-zinc-500">{crewName ?? 'Crew unassigned'}</span>
                <span className="font-bold text-zinc-900">
                  {fmtCents(move.actual_total_cents ?? move.price_total_cents)}
                  {move.actual_total_cents ? '' : ' est.'}
                </span>
              </div>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-200 p-3 text-[11px] text-zinc-400">
              No active or upcoming move. This is likely a general question.
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <ChatPanel
        threadId={id}
        initialMessages={messages ?? []}
        customerName={customer?.full_name ?? 'Customer'}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 uppercase tracking-wider font-semibold">
        {label}
      </dt>
      <dd className="text-zinc-900 mt-0.5">{value}</dd>
    </div>
  );
}
