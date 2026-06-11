// =============================================================================
// useDriverNavigation — watch GPS + push pings + compute ETA to the next
// waypoint, for the in-app navigation screen.
//
// Why a hook (not a screen-level useEffect):
//   • watchPositionAsync needs careful cleanup or it leaks a high-accuracy
//     subscription that hammers battery long after the screen unmounts
//   • the screen + a future heads-up alert can both share the same source
//   • the ping-throttle logic lives in one place
//
// Behaviour:
//   • requests foreground location permission once
//   • opens a watchPositionAsync subscription (~3 m / 2 s granularity)
//   • pushes every 5th update to the tracking-ping edge fn (~10 s cadence)
//   • returns { coord, heading, speedKph, etaMinutes } for the caller to render
//
// Pause / resume:
//   pass enabled=false to fully tear down the subscription (e.g. when the
//   booking flips to completed, or the screen is backgrounded).
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useSendTrackingPing } from '@/lib/data';
import { haversineKm } from '@/lib/distance';

export interface NavCoord {
  lat: number;
  lng: number;
}

export interface DriverNavState {
  coord: NavCoord | null;
  heading: number | null;
  speedKph: number | null;
  /** Straight-line × 1.3 road-fudge ÷ ~50 kph city ETA estimate, in minutes. */
  etaMinutes: number | null;
  /** Crow-flies km × 1.3 to the active target. */
  remainingKm: number | null;
  /** Set to a friendly message when permission denied or location offline. */
  error: string | null;
}

interface Args {
  bookingId: string;
  /** Destination we're navigating to right now (pickup or dropoff). */
  target: NavCoord | null;
  /** false stops the location watcher (e.g. job completed). */
  enabled?: boolean;
}

export function useDriverNavigation({ bookingId, target, enabled = true }: Args): DriverNavState {
  const [state, setState] = useState<DriverNavState>({
    coord: null,
    heading: null,
    speedKph: null,
    etaMinutes: null,
    remainingKm: null,
    error: null,
  });
  const tickRef = useRef(0);
  const sendPing = useSendTrackingPing();

  useEffect(() => {
    if (!enabled || !bookingId) return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      try {
        const Location = await import('expo-location').catch(() => null);
        if (!Location) {
          if (!cancelled)
            setState((s) => ({
              ...s,
              error: 'Location unavailable on this build. Use Open in Maps instead.',
            }));
          return;
        }
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled)
            setState((s) => ({
              ...s,
              error: 'Location permission denied — enable it in Settings to use in-app navigation.',
            }));
          return;
        }

        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000,
            distanceInterval: 3,
          },
          (pos) => {
            if (cancelled) return;
            const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            const heading = pos.coords.heading ?? null;
            const speedKph =
              pos.coords.speed != null && pos.coords.speed >= 0
                ? pos.coords.speed * 3.6
                : null;

            // ETA — road-fudged crow-flies / average speed. We deliberately
            // floor average speed at 25 kph so a stopped truck doesn't show
            // "ETA 4 hr" the second it pauses at a light.
            let etaMinutes: number | null = null;
            let remainingKm: number | null = null;
            if (target) {
              remainingKm = haversineKm(coord, target) * 1.3;
              const movingSpeed = Math.max(25, speedKph ?? 40);
              etaMinutes = Math.max(1, Math.round((remainingKm / movingSpeed) * 60));
            }
            setState({ coord, heading, speedKph, etaMinutes, remainingKm, error: null });

            // Throttled tracking-ping: every ~10 s (every 5th update at the
            // 2 s timeInterval). Anything more chatty than that and we burn
            // the per-driver rate limit (720 / hr) on a single long move.
            tickRef.current += 1;
            if (tickRef.current % 5 === 0) {
              sendPing.mutate({
                booking_id: bookingId,
                lat: coord.lat,
                lng: coord.lng,
                heading: heading ?? undefined,
                speed_kph: speedKph ?? undefined,
              });
            }
          },
        );
      } catch (e: any) {
        if (!cancelled)
          setState((s) => ({
            ...s,
            error: e?.message ?? 'Could not start location updates.',
          }));
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled, bookingId, target?.lat, target?.lng]);

  return state;
}
