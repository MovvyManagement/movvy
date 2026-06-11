// =============================================================================
// useUserLocation — get the device's current lat/lng once on mount
//
// Used by the home-screen LiveMap so it opens centered on where the
// customer actually IS, not on downtown Calgary by default.
//
// Permission flow:
//   1. Ask for foreground location permission (one-shot, cached by the OS)
//   2. If granted → call getCurrentPositionAsync (low accuracy, fast)
//   3. If denied or anything fails → return null and caller falls back
//
// Lazy-imports expo-location so the SDK is optional. Without it, this
// hook just returns null (no crash, no permission prompt).
// =============================================================================

import { useEffect, useState } from 'react';

export interface UserLocation {
  lat: number;
  lng: number;
}

export function useUserLocation(): UserLocation | null {
  const [loc, setLoc] = useState<UserLocation | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Location = await import('expo-location').catch(() => null);
        if (!Location) return; // SDK not installed
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        // Balanced accuracy keeps it fast (no satellite lock needed) — we
        // just need ballpark city-level for centring the map.
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // permission denied, hardware unavailable, etc — fall back silently
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return loc;
}
