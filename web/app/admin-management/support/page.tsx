// =============================================================================
// /admin-management/support — customer support inbox.
//
// One row per support thread (one per customer, lifetime-persistent).
// Sorted by last_message_at desc so the freshest customer reply is on
// top. Tap a row → real-time chat panel.
//
// The "waiting" badge surfaces threads where the most recent message
// came from the customer (not the admin) — those are the ones that
// need an answer. We compute that with a sub-query rather than storing
// a denormalized flag, so the truth lives in chat_messages.
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtRelative } from '@/lib/format';
import { RealtimeRefresh } from '../_components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function SupportInboxPage() {
  const supabase = await supabaseServer();

  // Pull threads with the customer profile joined inline. last_message_at
  // is updated by chat-send so threads stay sorted without us re-sorting
  // on every load.
  const { data: threads } = await supabase
    .from('chat_threads')
    .select(
      'id, customer_profile_id, last_message_at, created_at, customer:profiles!chat_threads_customer_profile_id_fkey(full_name, email, phone)',
    )
    .eq('kind', 'support')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  // For each thread, fetch the last message so we can preview + decide
  // who sent it last (drives the "waiting" badge). Done in parallel.
  const enriched = await Promise.all(
    (threads ?? []).map(async (t: any) => {
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('body, is_admin, sender_profile_id, created_at')
        .eq('thread_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...t, last_message: lastMsg };
    }),
  );

  const waitingCount = enriched.filter(
    (t) => t.last_message && !t.last_message.is_admin,
  ).length;

  return (
    <div className="px-8 py-8">
      {/* Live: a new customer message pushes the thread to the top + flips
          its "Waiting" badge instantly. Subscribes to BOTH chat_threads
          (new threads, last_message_at bumps) AND chat_messages (new
          customer replies update the waiting state). */}
      <RealtimeRefresh
        channel="admin-support-inbox"
        tables={['chat_threads', 'chat_messages']}
      />

      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Support inbox</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {enriched.length} thread{enriched.length === 1 ? '' : 's'} ·{' '}
            <span
              className={
                waitingCount > 0 ? 'text-amber-700 font-semibold' : ''
              }
            >
              {waitingCount} waiting for reply
            </span>
            {' '}· updates live
          </p>
        </div>
      </div>

      {enriched.length === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-10 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-zinc-900">No support chats yet.</p>
          <p className="text-xs text-zinc-500 mt-1">
            When a customer opens the support hub in the mobile app, a thread shows up here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
          {enriched.map((t: any) => (
            <Link
              key={t.id}
              href={`/admin-management/support/${t.id}`}
              className="flex items-center px-5 py-4 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center text-sm font-bold text-zinc-700">
                {(t.customer?.full_name ?? t.customer?.email ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="ml-4 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold text-zinc-900 truncate">
                    {t.customer?.full_name ?? t.customer?.email ?? 'Customer'}
                  </div>
                  {t.last_message && !t.last_message.is_admin ? (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                      Waiting
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-zinc-500 truncate mt-0.5">
                  {t.last_message
                    ? `${t.last_message.is_admin ? 'You: ' : ''}${t.last_message.body}`
                    : 'No messages yet'}
                </div>
              </div>
              <div className="text-xs text-zinc-400 ml-3 whitespace-nowrap">
                {fmtRelative(t.last_message_at ?? t.created_at)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
