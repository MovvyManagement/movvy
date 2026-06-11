// =============================================================================
// useTrackingHeartbeat — background GPS pinger for an active booking.
//
// Why this exists separately from useDriverNavigation:
//   useDriverNavigation only runs while the driver is on the in-app turn-by-
//   turn navigate screen. The customer-facing live tracker reads booking_tracking
//   inserts via Realtime — if the driver never opens Navigate, the customer
//   sees no pin moving. This hook runs on the Active job screen the whole
//   time a booking is in-flight, so wherever the driver is in the app, their
//   pin keeps updating on the customer's map.
//
// Behaviour:
//   • Only ticks while a booking is in a "moving" status (on_the_way / arrived /
//     loading / in_transit / unloading). Pre-acceptance or post-completion it
//     no-ops so we don't drain battery on a parked truck.
//   • Pings every ~10s — same cadence as useDriverNavigation, well under the
//     720/hr per-driver rate limit.
//   • Uses balanced accuracy on the active screen (lat/lng within ~10m is fine
//     for the customer's live map); the navigate screen still gets high-
//     accuracy via useDriverNavigation when actually driving turn-by-turn.
//   • Cleans up the location subscription on unmount AND on status leaving
//     the moving set.
// =============================================================================

import { useEffect, useRef } from 'react';
import { useSendTrackingPing } from '@/lib/data';
import type { BookingStatus } from '@/types';

const MOVING_STATUSES: BookingStatus[] = [
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
];

interface Args {
  bookingId: string | undefined;
  status: BookingStatus | undefined;
  /** Set false to halt entirely (e.g. when the user backgrounds the app
   *  and you want to be conservative about battery). */
  enabled?: boolean;
}

export function useTrackingHeartbeat({ bookingId, status, enabled = true }: Args): void {
  const sendPing = useSendTrackingPing();
  const sendPingRef = useRef(sendPing);
  // Keep the latest mutation in a ref so we don't tear down the watcher every
  // render. The mutation identity changes on each render but the underlying
  // edge-fn invocation is stable.
  sendPingRef.current = sendPing;

  const active =
    enabled && !!bookingId && !!status && MOVING_STATUSES.includes(status);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    let tickIdx = 0;

    (async () => {
      try {
        // expo-location is a lazy import so the package isn't dragged into
        // web builds (web doesn't run watchPositionAsync anyway).
        const Location = await import('expo-location').catch(() => null);
        if (!Location) return;

        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') return;

        sub = await Location.watchPositionAsync(
          {
            // Balanced accuracy is enough for the customer's live map — saves
            // ~30% battery vs High on long jobs. useDriverNavigation re-opens
            // a High-accuracy watcher when the driver is actually navigating
            // turn-by-turn, so we don't lose precision when it matters.
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 2000,
            distanceInterval: 8,
          },
          (pos) => {
            if (cancelled) return;
            tickIdx += 1;
            // Throttle to one ping per ~10s. watchPositionAsync fires every
            // 2s; pinging every 5th update gives a ~10s cadence.
            if (tickIdx % 5 !== 0) return;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const heading = pos.coords.heading ?? undefined;
            const speedKph =
              pos.coords.speed != null && pos.coords.speed >= 0
                ? pos.coords.speed * 3.6
                : undefined;
            sendPingRef.current.mutate({
              booking_id: bookingId!,
              lat,
              lng,
              heading,
              speed_kph: speedKph,
            });
          },
        );
      } catch {
        // Permissions or hardware error — non-fatal. The customer's tracker
        // gracefully falls back to "no pin yet" until the driver fixes
        // their GPS / permission setup.
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active, bookingId]);
}
