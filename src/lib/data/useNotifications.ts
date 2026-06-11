// =============================================================================
// useNotifications — in-app inbox driven by the `notifications` table
//
// Backend wiring:
//   • table `notifications` (migration 0004): profile_id, channel, category,
//     title, body, data, created_at, read_at
//   • trigger `bookings_notify_status` (migration 0009): inserts a row on
//     every booking status change for the customer (assigned, on_the_way,
//     arrived, completed, ...) — already shipped.
//
// We only read channel='in_app' here (push/email/sms are handled elsewhere).
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export interface AppNotification {
  id: string;
  profile_id: string;
  category: string;        // e.g. 'booking.on_the_way'
  title: string;
  body: string;
  data: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

/** Latest N in-app notifications for the signed-in user, newest first. */
export function useNotifications(limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id, limit],
    enabled: !!user?.id && supabaseConfigured,
    refetchInterval: 20_000, // light polling; push will land in the same table
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, profile_id, category, title, body, data, read_at, created_at')
        .eq('profile_id', user!.id)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
  });
}

/** Just the unread count — cheap head query, used by the bell badge. */
export function useUnreadNotificationCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications-unread-count', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    refetchInterval: 20_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user!.id)
        .eq('channel', 'in_app')
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Mark a single notification as read; safe to call repeatedly. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}

/** Mark all unread notifications as read in one round-trip. */
export function useMarkAllNotificationsRead() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('profile_id', user!.id)
        .eq('channel', 'in_app')
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}
