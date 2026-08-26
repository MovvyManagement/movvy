// =============================================================================
// useNotificationDeepLink — send a tapped push to the relevant screen.
//
// notifications-push attaches `data.booking_id` (+ a `category`) to booking
// pushes. Before this, tapping a notification just opened the app wherever it
// last was; now it routes the user to the booking.
//
// Routing:
//   • data.url (an absolute app path) wins — future-proof if the backend ever
//     starts sending an explicit deep link.
//   • otherwise a booking_id routes to the CURRENT portal's moves/jobs screen,
//     inferred from the active route group, so one push pipeline works for
//     customers, movers, companies and admins alike.
//
// Also installs the foreground notification handler (there wasn't one), so
// pushes that arrive while the app is open actually show a banner.
//
// Native only (guarded off web). Covers warm taps and cold starts.
// =============================================================================

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router, useSegments } from 'expo-router';

function routeForNotification(data: any, segments: string[]): string | null {
  if (!data) return null;
  // Explicit deep link always wins.
  if (typeof data.url === 'string' && data.url.startsWith('/')) return data.url;

  const hasBooking = !!(data.booking_id ?? data.bookingId);
  if (!hasBooking) return null;

  // Land on the current portal's moves/jobs surface. The customer Moves tab
  // auto-renders the live tracker for an active move, so this lands "on the
  // booking" for the common cases (on-the-way, tip, refund, new job, etc.).
  switch (segments?.[0]) {
    case '(mover)':
      return '/(mover)/(tabs)/active';
    case '(company)':
      return '/(company)/(tabs)/jobs';
    case '(admin)':
      return '/(admin)/bookings';
    default:
      return '/(customer)/bookings';
  }
}

export function useNotificationDeepLink() {
  const segments = useSegments();
  // Keep the latest segments available to the async listener without
  // re-subscribing on every navigation.
  const segRef = useRef<string[]>(segments as string[]);
  segRef.current = segments as string[];

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let sub: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      let Notifications: typeof import('expo-notifications');
      try {
        Notifications = await import('expo-notifications');
      } catch {
        return; // package unavailable — non-fatal
      }

      // Foreground display — none was configured before, so in-app pushes were
      // silent. Show a banner + play the sound; badge left untouched.
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      const go = (data: unknown) => {
        const route = routeForNotification(data as any, segRef.current);
        if (!route) return;
        // Defer so a cold-start tap doesn't race the auth redirect that runs on
        // first mount. If the route isn't ready, the push is a harmless no-op.
        setTimeout(() => {
          try {
            router.push(route as any);
          } catch {
            /* navigation not ready — ignore */
          }
        }, 500);
      };

      // Cold start: the app was launched by tapping a notification.
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last && !cancelled) go(last.notification.request.content.data);
      } catch {
        /* ignore */
      }

      // Warm: tapped while the app was running or backgrounded.
      sub = Notifications.addNotificationResponseReceivedListener((resp) => {
        go(resp.notification.request.content.data);
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove?.();
    };
    // Drivers are stable refs; subscribe once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
