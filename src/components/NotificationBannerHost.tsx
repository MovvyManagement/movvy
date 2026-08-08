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
  // Twin keys already banner'd this session — see the dedupe note below.
  const seenRef = useRef<Set<string>>(new Set());

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

          // ── Suppress the in_app/push twin ─────────────────────────────────
          // Five event classes write TWO rows with identical title+body — one
          // 'in_app' for the inbox, one 'push' for the Expo pipeline (0022:
          // assigned, on_the_way, arrived, completed, cancelled; also the two
          // partner join events and the reminder crons). We must watch both
          // channels, because a manual admin send via notifications-send
          // writes a 'push' row with no in_app twin — filtering to in_app
          // alone would silence it. So dedupe on the pair instead.
          //
          // The twins are written in ONE transaction, and created_at defaults
          // to now() — transaction start — so a twin pair shares created_at to
          // the microsecond while two genuinely separate events never do.
          // That makes this key exact: it drops the duplicate banner without
          // ever swallowing a real second notification, even one with the same
          // wording seconds later.
          const twinKey = `${row.category}|${title}|${body}|${row.created_at}`;
          if (seenRef.current.has(twinKey)) return;
          seenRef.current.add(twinKey);
          if (seenRef.current.size > 200) {
            // Bound the set on a long session; insertion order is oldest-first.
            const oldest = seenRef.current.values().next().value;
            if (oldest !== undefined) seenRef.current.delete(oldest);
          }

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
