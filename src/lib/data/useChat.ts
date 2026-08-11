// Chat — thread list, send via edge function, realtime subscription on a thread.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

export interface ChatThread {
  id: string;
  kind: 'booking' | 'support';
  booking_id: string | null;
  customer_profile_id: string;
  partner_profile_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_profile_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
}

export function useMyThreads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat', 'threads', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<ChatThread[]> => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as ChatThread[];
    },
  });
}

/**
 * A single thread row — needed to work out WHICH SIDE of the conversation each
 * message came from.
 *
 * A chat is between two sides (the customer, and the crew), not between two
 * people. The crew side can be several people: the admin who took the job and
 * whichever members are on it. So "did I send this" is the wrong question for
 * deciding how a bubble looks — the right one is "is the sender on my side",
 * and `customer_profile_id` is what answers it.
 *
 * Readable by an assigned crew member: chat_threads_participant (0005) allows
 * select when is_assigned_to_booking(booking_id).
 */
export function useChatThread(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat', 'thread', threadId],
    enabled: !!threadId,
    queryFn: async (): Promise<ChatThread | null> => {
      const { data, error } = await supabase
        .from('chat_threads')
        .select('*')
        .eq('id', threadId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ChatThread | null;
    },
  });
}

/** Realtime-backed list of messages for a thread. */
export function useThreadMessages(threadId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (!cancelled) {
        setMessages((data ?? []) as ChatMessage[]);
        setLoading(false);
      }
    })();

    // Unique per-mount channel name — see useTracking.ts comment.
    const channel = supabase
      .channel(`chat-${threadId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          if (!cancelled) setMessages((cur) => [...cur, payload.new as ChatMessage]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  return { messages, loading };
}

export function useSendChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { thread_id: string; body: string }) => {
      const { data, error } = await supabase.functions.invoke('chat-send', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['chat', 'threads'] });
      // Realtime handles inserts; this just bumps thread sort
    },
  });
}

/** Ensure a booking thread exists; create on demand. */
export function useEnsureBookingThread() {
  return useMutation({
    mutationFn: async (booking_id: string): Promise<string> => {
      // Try lookup
      const { data: existing } = await supabase
        .from('chat_threads')
        .select('id')
        .eq('booking_id', booking_id)
        .maybeSingle();
      if (existing) return existing.id;

      // Need booking + driver to create
      const { data: booking } = await supabase
        .from('bookings')
        .select('id, customer_id, assigned_driver_profile_id')
        .eq('id', booking_id)
        .single();
      if (!booking) throw new Error('Booking not found');

      const { data: created, error } = await supabase
        .from('chat_threads')
        .insert({
          kind: 'booking',
          booking_id,
          customer_profile_id: booking.customer_id,
          partner_profile_id: booking.assigned_driver_profile_id,
        })
        .select('id')
        .single();
      if (error || !created) throw error ?? new Error('Could not create chat thread');
      return created.id;
    },
  });
}
