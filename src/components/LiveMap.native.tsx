import React, { useEffect, useRef, useState } from 'react';
import { View, Easing } from 'react-native';
import MapView, {
  Marker,
  MarkerAnimated,
  AnimatedRegion,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import { CALGARY, fetchRoute, type LatLng } from '@/lib/geocoding';

// Native (iOS / Android) implementation of <LiveMap />.
// Metro picks this file over LiveMap.tsx when the platform is iOS or Android.
//
// 3.1: When pickup.label === 'Driver' (live tracking mode), we drive an
// AnimatedRegion so the pin glides smoothly between GPS pings instead of
// teleporting. ~1.5s ease-linear interpolation.

export interface LiveMapProps {
  height?: number;
  pickup?: { lat: number; lng: number; label?: string };
  dropoff?: { lat: number; lng: number; label?: string };
  caption?: string;
  showRoute?: boolean;
  /** Fallback center when no pickup/dropoff is set yet (e.g. the user's
   *  GPS location on the home-screen booking widget). */
  initialCenter?: { lat: number; lng: number };
  /** Corner radius of the map container. Default 24; pass 0 for a full-bleed
   *  hero (e.g. the Option B booking screen). */
  borderRadius?: number;
}

export function LiveMap({ height = 220, pickup, dropoff, showRoute, initialCenter, borderRadius = 24 }: LiveMapProps) {
  const ref = useRef<MapView | null>(null);
  const driverCoord = useRef<AnimatedRegion | null>(null);
  const isDriverPin = pickup?.label === 'Driver';

  // Road-following route coordinates. Null until fetched (or when road routing
  // is unavailable) — in which case we draw the straight pickup→dropoff line.
  const [routeCoords, setRouteCoords] = useState<LatLng[] | null>(null);

  // Fit the visible region to the route if we have one, else to the two pins.
  // Called both from the coords effect AND from onMapReady, because on first
  // mount the map often isn't laid out yet when the effect first runs — that
  // race is why the Moves map didn't reliably frame both pins.
  const fitToPins = () => {
    if (!ref.current) return;
    if (routeCoords && routeCoords.length >= 2) {
      ref.current.fitToCoordinates(routeCoords, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
      return;
    }
    if (pickup && dropoff) {
      ref.current.fitToCoordinates(
        [
          { latitude: pickup.lat, longitude: pickup.lng },
          { latitude: dropoff.lat, longitude: dropoff.lng },
        ],
        { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
      );
    }
  };

  // Origin of the last route we fetched — lets us skip re-routing on every GPS
  // ping when the origin is a moving pin (driver). We only re-fetch once the
  // pin has drifted far enough that the old road route is stale.
  const lastRouteOrigin = useRef<{ lat: number; lng: number } | null>(null);

  // Fetch a road-following route from origin → destination so the line traces
  // streets instead of cutting straight across. Works for BOTH a static
  // pickup→dropoff (booking preview, company/driver job cards) AND a live
  // moving origin (the driver pin en route to pickup/drop-off) — for the live
  // case we throttle by distance so a car doesn't trigger a paid call every
  // ~10s ping. Falls back to the straight line when the backend can't route.
  const isLiveOrigin = pickup?.label === 'Driver' || pickup?.label === 'You';
  useEffect(() => {
    if (!showRoute || !pickup || !dropoff) {
      setRouteCoords(null);
      lastRouteOrigin.current = null;
      return;
    }
    // Throttle re-routing for a moving origin: reuse the current route until
    // the driver has moved > ~400 m from where we last routed.
    if (isLiveOrigin && routeCoords && lastRouteOrigin.current) {
      const moved = haversineMeters(lastRouteOrigin.current, { lat: pickup.lat, lng: pickup.lng });
      if (moved < 400) return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    fetchRoute(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng },
      ctrl.signal,
    ).then((coords) => {
      if (cancelled) return;
      setRouteCoords(coords);
      if (coords) lastRouteOrigin.current = { lat: pickup.lat, lng: pickup.lng };
    });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoute, isLiveOrigin, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // 3.1: smooth driver-pin interpolation
  useEffect(() => {
    if (!isDriverPin || !pickup) return;
    if (!driverCoord.current) {
      driverCoord.current = new AnimatedRegion({
        latitude: pickup.lat,
        longitude: pickup.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      return;
    }
    // Glide to the new ping over 1.5s — looks like motion, not a jump
    (driverCoord.current as any)
      .timing({
        latitude: pickup.lat,
        longitude: pickup.lng,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: false,
      })
      .start();
  }, [isDriverPin, pickup?.lat, pickup?.lng]);

  useEffect(() => {
    if (!ref.current) return;
    if (pickup && dropoff) {
      fitToPins();
    } else if (pickup) {
      ref.current.animateToRegion(
        {
          latitude: pickup.lat,
          longitude: pickup.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        500
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, routeCoords]);

  return (
    <View
      style={{
        height,
        borderRadius,
        overflow: 'hidden',
        backgroundColor: '#ECFDF5',
      }}
    >
      <MapView
        ref={ref}
        // Force Google Maps on BOTH platforms. Android already defaults to
        // Google; this switches iOS off Apple Maps too so pins/tiles/labels
        // match across devices. Requires the mobile Maps SDK key wired into
        // native config (app.config.ts → ios.config.googleMapsApiKey /
        // android.config.googleMaps.apiKey) — without it iOS renders blank.
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={{
          // Priority: pickup pin > caller-passed initialCenter (user GPS) > Calgary default
          latitude: pickup?.lat ?? initialCenter?.lat ?? CALGARY.center.lat,
          longitude: pickup?.lng ?? initialCenter?.lng ?? CALGARY.center.lng,
          latitudeDelta: pickup ? 0.02 : initialCenter ? 0.05 : 0.18,
          longitudeDelta: pickup ? 0.02 : initialCenter ? 0.05 : 0.18,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
        // Re-fit once the map is actually laid out — the mount-time effect can
        // fire before the map is ready, which left the Moves map un-framed.
        onMapReady={fitToPins}
      >
        {pickup ? (
          isDriverPin && driverCoord.current ? (
            <MarkerAnimated
              coordinate={driverCoord.current as any}
              title={pickup.label || 'Driver'}
              pinColor="#0A0A0A"
            />
          ) : (
            <Marker
              coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
              title={pickup.label || 'Pickup'}
              pinColor="#0A0A0A"
            />
          )
        ) : null}
        {dropoff ? (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            title={dropoff.label || 'Drop-off'}
            pinColor="#16A34A"
          />
        ) : null}
        {showRoute && pickup && dropoff ? (
          <Polyline
            // Road-following coordinates when the directions backend gave us a
            // route; otherwise the straight pickup→dropoff segment.
            coordinates={
              routeCoords && routeCoords.length >= 2
                ? routeCoords
                : [
                    { latitude: pickup.lat, longitude: pickup.lng },
                    { latitude: dropoff.lat, longitude: dropoff.lng },
                  ]
            }
            strokeColor="#047857"
            strokeWidth={4}
          />
        ) : null}
      </MapView>
    </View>
  );
}

// Great-circle distance in metres — used to throttle live re-routing.
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
