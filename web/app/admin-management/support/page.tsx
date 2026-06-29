// =============================================================================
// /admin-management/support — customer support inbox.
//
// Enhancements over v1:
// · SLA indicator — threads waiting > 4h shown with amber badge
// · Customer contact info shown inline (email, phone)
// · Message preview with sender context
// · Waiting count highlighted prominently
// · Empty state with onboarding hint
// =============================================================================

import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtRelative, fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

// SLA threshold: flag threads waiting longer than this many ms
const SLA_WARNING_MS = 4 * 60 * 60 * 1000; // 4 hours

export default async function SupportInboxPage() {
  const supabase = await supabaseServer();

  const { data: threads } = await supabase
    .from('chat_threads')
    .select(
      'id, customer_profile_id, last_message_at, created_at, customer:profiles!chat_threads_customer_profile_id_fkey(full_name, email, phone)',
    )
    .eq('kind', 'support')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  // Enrich with last message for preview + waiting indicator
  const enriched = await Promise.all(
    (threads ?? []).map(async (t: any) => {
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('body, is_admin, created_at')
        .eq('thread_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...t, last_message: lastMsg };
    }),
  );

  const waitingThreads = enriched.filter(
    (t) => t.last_message && !t.last_message.is_admin,
  );
  const slaBreached = waitingThreads.filter((t) => {
    if (!t.last_message?.created_at) return false;
    return Date.now() - new Date(t.last_message.created_at).getTime() > SLA_WARNING_MS;
  });

  return (
    <div className="px-6 py-6">

      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Support Inbox</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {enriched.length} thread{enriched.length !== 1 ? 's' : ''} · updates live
          </p>
        </div>
        <div className="flex items-center gap-3">
          {slaBreached.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-100">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-xs font-semibold text-red-700">
                {slaBreached.length} breached 4h SLA
              </span>
            </div>
          )}
          {waitingThreads.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-100">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-semibold text-amber-700">
                {waitingThreads.length} waiting for reply
              </span>
            </div>
          )}
        </div>
      </div>

      {enriched.length === 0 ? (
        <div className="rounded-2xl bg-white border border-zinc-200 border-dashed p-12 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-zinc-900">No support chats yet</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
            When a customer opens the support hub in the mobile app, a thread appears here automatically.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden">
          {enriched.map((t: any, idx: number) => {
            const isWaiting = t.last_message && !t.last_message.is_admin;
            const isSlaBreached =
              isWaiting &&
              t.last_message?.created_at &&
              Date.now() - new Date(t.last_message.created_at).getTime() > SLA_WARNING_MS;
            const customerName = t.customer?.full_name ?? t.customer?.email ?? 'Customer';
            const initials = customerName[0]?.toUpperCase() ?? '?';

            return (
              <Link
                key={t.id}
                href={`/admin-management/support/${t.id}`}
                className="flex items-center px-5 py-4 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors gap-4"
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  isSlaBreached ? 'bg-red-100 text-red-700' : isWaiting ? 'bg-amber-100 text-amber-700' : 'bg-zinc-200 text-zinc-600'
                }`}>
                  {initials}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-zinc-900 truncate">{customerName}</span>
                    {isSlaBreached && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold whitespace-nowrap">
                        SLA Breached
                      </span>
                    )}
                    {!isSlaBreached && isWaiting && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold whitespace-nowrap">
                        Waiting
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {t.last_message
                      ? `${t.last_message.is_admin ? 'You: ' : ''}${t.last_message.body}`
                      : 'No messages yet'}
                  </div>
                  {t.customer?.phone && (
                    <div className="text-xs text-zinc-400 mt-0.5">{t.customer.phone}</div>
                  )}
                </div>

                {/* Time + arrow */}
                <div className="text-right shrink-0">
                  <div className="text-xs text-zinc-400 whitespace-nowrap">
                    {fmtRelative(t.last_message_at ?? t.created_at)}
                  </div>
                  {isSlaBreached && t.last_message?.created_at && (
                    <div className="text-xs text-red-600 font-semibold mt-0.5 whitespace-nowrap">
                      {fmtRelative(t.last_message.created_at)} unanswered
                    </div>
                  )}
                </div>
                <svg className="h-4 w-4 text-zinc-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
