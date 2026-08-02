// =============================================================================
// bgTracking — background live-location broadcaster for an in-flight move.
//
// The crew member chosen as the tracking source keeps sharing their location
// with the customer EVEN WHEN THE APP IS BACKGROUNDED OR CLOSED, for as long as
// the move is going. This uses a real OS background-location task (not the
// foreground-only watchPositionAsync heartbeat):
//   • startLiveLocation(bookingId) — requests Always permission, remembers the
//     booking, and starts OS location updates that wake the app in the
//     background to ping.
//   • The TaskManager task pings tracking-ping every update, and self-stops if
//     the move is no longer in a moving state (so it cleans up even if the app
//     was killed mid-move).
//   • stopLiveLocation() — tears it down when the move ends.
//
// Requires (native): UIBackgroundModes 'location' + Always location permission
// (iOS Info.plist) and ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE
// (Android). Configured in app.config + ios/Movvy/Info.plist.
// =============================================================================

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export const LIVE_LOCATION_TASK = 'movvy-live-location';
const BOOKING_KEY = 'movvy.liveLocation.bookingId';

// Statuses during which the customer should see live movement. Kept in sync
// with useTrackingHeartbeat's MOVING_STATUSES.
const MOVING = ['on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'];

TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
  const loc = locations?.[locations.length - 1];
  if (!loc) return;

  let bookingId: string | null = null;
  try {
    bookingId = await AsyncStorage.getItem(BOOKING_KEY);
  } catch {
    /* noop */
  }
  if (!bookingId) return;

  // Self-clean: if the move is over (or gone), stop broadcasting even if the
  // foreground hook never got a chance to (e.g. the app was killed mid-move).
  try {
    const { data: b } = await supabase
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .maybeSingle();
    if (!b || !MOVING.includes((b as any).status)) {
      await stopLiveLocation();
      return;
    }
  } catch {
    /* if we can't check, still send the ping below */
  }

  try {
    const h = loc.coords.heading;
    const s = loc.coords.speed;
    await supabase.functions.invoke('tracking-ping', {
      body: {
        booking_id: bookingId,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        heading: h != null && h >= 0 ? h : undefined,
        speed_kph: s != null && s >= 0 ? Math.round(s * 3.6) : undefined,
      },
    });
  } catch {
    /* transient — the next update will try again */
  }
});

/** Begin broadcasting this device's location for the given booking. Returns
 *  false if location permission wasn't granted. */
export async function startLiveLocation(bookingId: string): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    // "Always" is what keeps it alive in the background; if the user only grants
    // While-Using, updates still flow while the app is foregrounded.
    await Location.requestBackgroundPermissionsAsync().catch(() => {});

    await AsyncStorage.setItem(BOOKING_KEY, bookingId);

    const already = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(
      () => false,
    );
    if (!already) {
      await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 25, // metres between updates
        deferredUpdatesInterval: 10_000, // ~10s cadence, matches the old heartbeat
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.AutomotiveNavigation,
        foregroundService: {
          notificationTitle: 'Movvy — live location on',
          notificationBody: "Sharing your location with the customer for this move.",
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Stop broadcasting (move finished / cancelled / this device no longer the source). */
export async function stopLiveLocation(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BOOKING_KEY);
    const started = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK).catch(
      () => false,
    );
    if (started) await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  } catch {
    /* noop */
  }
}
