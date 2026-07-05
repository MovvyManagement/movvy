// =============================================================================
// ChatPanel — real-time admin-side chat for a single support thread.
//
// Three responsibilities:
//   1. Render the message history seeded by the server.
//   2. Subscribe to chat_messages via Supabase Realtime so customer
//      messages appear without a refresh.
//   3. Send admin replies through the chat-send edge function. We
//      don't insert directly — the edge function bumps last_message_at
//      on the thread, which keeps the inbox sort order honest.
// =============================================================================

'use client';

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Message {
  id: string;
  body: string;
  is_admin: boolean;
  is_ai?: boolean;
  sender_profile_id: string | null;
  created_at: string;
}

export function ChatPanel({
  threadId,
  initialMessages,
  customerName,
}: {
  threadId: string;
  initialMessages: Message[];
  customerName: string;
}) {
  const supabase = supabaseBrowser();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message whenever the list updates.
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  // Real-time subscription. The Postgres-changes channel only fires for
  // inserts that match `filter: thread_id=eq.<this>`, so we don't get
  // bombarded with every chat message in the system.
  useEffect(() => {
    const channel = supabase
      .channel(`support:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload: { new: Message }) => {
          const row = payload.new;
          setMessages((prev) =>
            // Guard against echoes from our own send — if we already have
            // a message with this id (e.g. an optimistic insert), skip.
            prev.some((m) => m.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, threadId]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke(
        'chat-send',
        { body: { thread_id: threadId, body } },
      );
      if (invErr) throw invErr;
      if ((data as any)?.error) throw new Error((data as any).error);
      // Realtime will deliver the row — we just clear the draft.
      setDraft('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not send. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-50">
      <div className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="text-sm font-bold text-zinc-900">
          Chat with {customerName}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          Replies are sent as Movvy support — the customer sees them tagged
          with your admin role.
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-zinc-500 mt-12">
            No messages yet in this thread.
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {error ? (
            <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Reply to ${customerName}…`}
              rows={2}
              disabled={sending}
              className="flex-1 px-4 py-3 rounded-2xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="px-5 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end h-12"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <div className="text-xs text-zinc-400 mt-2">
            Enter to send · Shift+Enter for a new line
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isAdmin = message.is_admin;
  const isAi = !!message.is_ai;
  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-md">
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            isAi
              ? 'bg-violet-600 text-white rounded-br-sm'
              : isAdmin
              ? 'bg-emerald-600 text-white rounded-br-sm'
              : 'bg-white border border-zinc-200 text-zinc-900 rounded-bl-sm'
          }`}
        >
          {message.body}
        </div>
        <div className={`text-xs text-zinc-400 mt-1 ${isAdmin ? 'text-right' : ''}`}>
          {isAi ? 'AI assistant' : isAdmin ? 'Support' : 'Customer'} ·{' '}
          {new Date(message.created_at).toLocaleTimeString('en-CA', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
