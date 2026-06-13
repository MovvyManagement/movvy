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
import { ChatPanel } from './ChatPanel';

export const dynamic = 'force-dynamic';

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
        </dl>
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
