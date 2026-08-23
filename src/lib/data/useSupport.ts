// =============================================================================
// Customer support hooks
//
//   • useEnsureSupportThread  — opens the customer↔Movvy chat thread
//   • useSupportInbox         — the admin side of those threads
//   • useUpdateEmergencyContact
//
// The claim and dispute submitters that used to live here went with the support
// hub: Customer Service is a chat now, and a person raises the formal record
// from inside the thread. `useOpenDispute` (useDisputes.ts) is still the
// endpoint the live tracker and the crew's active-job screen file through.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

// ─── SOS ────────────────────────────────────────────────────────────────────

export interface SosArgs {
  booking_id: string;
  message?: string;
  lat?: number;
  lng?: number;
}

export interface SosResult {
  ok: true;
  recipients: number;
  emergency_sms_sent: boolean;
  police_notified: boolean;
  dispute_id: string | null;
  support_thread_id: string | null;
}


// ─── Support thread bootstrap ──────────────────────────────────────────────

export function useEnsureSupportThread() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('ensure_support_thread');
      if (error) throw error;
      if (!data) throw new Error('Could not open support thread');
      return data as string;
    },
  });
}

// ─── Admin / support-agent inbox ───────────────────────────────────────────
//
// Lists every active support thread for the support console
// (/(admin)/support). RLS already restricts chat_threads SELECT to admins
// (chat_threads_admin_all from migration 0005) so the query is safe to run
// from the user-scoped client. Sorted by most recent message so the
// freshest customer reply floats to the top.

export interface SupportInboxRow {
  thread_id: string;
  customer_profile_id: string;
  customer_name: string | null;
  customer_email: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export function useSupportInbox() {
  return useQuery({
    queryKey: ['admin-support-inbox'],
    refetchInterval: 15_000, // poll fresh threads every 15s
    queryFn: async (): Promise<SupportInboxRow[]> => {
      const { data: threads, error } = await supabase
        .from('chat_threads')
        .select(
          'id, customer_profile_id, last_message_at, customer:customer_profile_id(full_name, email)',
        )
        .eq('kind', 'support')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;

      if (!threads?.length) return [];

      // Fetch the last message body + a simple unread heuristic per thread.
      // For first pass: last message text. Unread = messages where
      // sender_profile_id = customer AND is_admin = false created since the
      // most recent admin reply. We approximate as "thread has any non-admin
      // message newer than its newest admin message".
      const threadIds = threads.map((t: any) => t.id);
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('thread_id, sender_profile_id, is_admin, body, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false })
        .limit(500);

      const preview = new Map<string, string>();
      const lastAdminAt = new Map<string, number>();
      const unread = new Map<string, number>();
      for (const m of msgs ?? []) {
        const id = (m as any).thread_id as string;
        if (!preview.has(id)) preview.set(id, ((m as any).body ?? '').slice(0, 140));
        const ts = new Date((m as any).created_at).getTime();
        if ((m as any).is_admin) {
          if (!lastAdminAt.has(id) || ts > (lastAdminAt.get(id) ?? 0)) {
            lastAdminAt.set(id, ts);
          }
        }
      }
      for (const m of msgs ?? []) {
        const id = (m as any).thread_id as string;
        const ts = new Date((m as any).created_at).getTime();
        const adminTs = lastAdminAt.get(id) ?? 0;
        if (!(m as any).is_admin && ts > adminTs) {
          unread.set(id, (unread.get(id) ?? 0) + 1);
        }
      }

      return threads.map((t: any) => ({
        thread_id: t.id,
        customer_profile_id: t.customer_profile_id,
        customer_name: t.customer?.full_name ?? null,
        customer_email: t.customer?.email ?? null,
        last_message_at: t.last_message_at,
        last_message_preview: preview.get(t.id) ?? null,
        unread_count: unread.get(t.id) ?? 0,
      }));
    },
  });
}

// ─── Insurance claim ───────────────────────────────────────────────────────
export interface EmergencyContactArgs {
  name: string | null;
  /** E.164 format — validated by the DB constraint. */
  phone: string | null;
}

export function useUpdateEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: EmergencyContactArgs) => {
      if (!supabaseConfigured) throw new Error('Backend not configured');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in first');
      const { error } = await supabase
        .from('profiles')
        .update({
          emergency_contact_name: args.name?.trim() || null,
          emergency_contact_phone: args.phone?.trim() || null,
        })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}
