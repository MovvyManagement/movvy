import React from 'react';
import { MapPlaceholder } from './MapPlaceholder';

// Web fallback. Metro auto-resolves `LiveMap.native.tsx` on iOS/Android.
export interface LiveMapProps {
  height?: number;
  pickup?: { lat: number; lng: number; label?: string };
  dropoff?: { lat: number; lng: number; label?: string };
  caption?: string;
  showRoute?: boolean;
  // Accepted for prop parity with the native version — no-op on web.
  initialCenter?: { lat: number; lng: number };
}

export function LiveMap({ height, pickup, caption, showRoute }: LiveMapProps) {
  return (
    <MapPlaceholder
      height={height}
      caption={caption ?? pickup?.label ?? 'Calgary, AB'}
      showRoute={showRoute}
    />
  );
}
