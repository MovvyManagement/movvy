// =============================================================================
// NotificationBannerHost — in-app banner for incoming notifications.
//
// The push pipeline (notifications insert → DB trigger → notifications-push →
// Expo) is fully built, but iOS push needs the `aps-environment` entitlement,
// which is a PAID Apple Developer entitlement — a free-provisioned build can't
// receive push at all. Until that account exists, a new chat message was
// completely silent while the app was open.
//
// This closes that gap without Apple: `notifications` is in the Realtime
// publication, so we subscribe to our own rows and surface a banner the moment
// one lands. Once real push is enabled this stays useful — iOS suppresses
// banners for the foregrounded app anyway, which is exactly when this fires.
// =============================================================================

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

export function NotificationBannerHost() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  // Keep the latest toast in a ref so the realtime subscription isn't torn down
  // and rebuilt every render.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!user?.id || !supabaseConfigured) return;

    const channel = supabase
      .channel(`notif-banner:${user.id}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          // Only user-facing channels — email/sms rows have their own delivery.
          if (row.channel && !['in_app', 'push'].includes(row.channel)) return;

          const title = String(row.title ?? 'Movvy');
          const body = String(row.body ?? '');
          haptic.light();
          toastRef.current.show(body ? `${title} — ${body}` : title, {
            variant: 'info',
            durationMs: 5000,
          });

          // Keep the bell badge + inbox honest without waiting for the poll.
          qc.invalidateQueries({ queryKey: ['notifications'] });
          qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  return null;
}
