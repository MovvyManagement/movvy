import React, { useEffect, useRef } from 'react';
import { View, Easing } from 'react-native';
import MapView, {
  Marker,
  MarkerAnimated,
  AnimatedRegion,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import { CALGARY } from '@/lib/geocoding';

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
      ref.current.fitToCoordinates(
        [
          { latitude: pickup.lat, longitude: pickup.lng },
          { latitude: dropoff.lat, longitude: dropoff.lng },
        ],
        { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
      );
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
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

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
            coordinates={[
              { latitude: pickup.lat, longitude: pickup.lng },
              { latitude: dropoff.lat, longitude: dropoff.lng },
            ]}
            strokeColor="#047857"
            strokeWidth={4}
          />
        ) : null}
      </MapView>
    </View>
  );
}
