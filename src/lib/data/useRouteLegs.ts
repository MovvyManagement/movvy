// =============================================================================
// useRouteLegs — the two driving legs a quote is built from, measured properly.
//
//   leg 1  HQ → pickup
//   leg 2  pickup → drop-off
//
// Both are billed time, and leg 2's distance decides whether the drop-off drive
// is charged one way or both, so these numbers ARE the price. Until now the
// engine estimated them as straight-line × 1.30 at a flat 80 km/h, which reads
// Calgary → Red Deer as 178 km against a real 150 — a ~$225 error on one
// booking once distance drives the total.
//
// One request covers both legs: origin = HQ, waypoint = pickup, destination =
// drop-off, and routes-distance returns Google's per-leg breakdown. Results are
// cached server-side for 24h, so repeated edits on the confirm screen cost
// nothing.
//
// Returns undefined while loading or if the call fails — computePricing then
// falls back to its own approximation, so a quote always renders.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { closestMajorCity } from '@/lib/distance';

export interface RouteLegs {
  hqToPickupKm: number;
  hqToPickupMinutes: number;
  pickupToDropoffKm: number;
  pickupToDropoffMinutes: number;
  /** 'google' when measured, 'haversine' when the API was unavailable. */
  source: string;
}

type Coord = { lat?: number | null; lng?: number | null } | null | undefined;

const has = (c: Coord): c is { lat: number; lng: number } =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);

const at = (c: Coord) => ({ lat: Number(c!.lat), lng: Number(c!.lng) });

export function useRouteLegs(pickup: Coord, dropoff: Coord) {
  const enabled = supabaseConfigured && has(pickup) && has(dropoff);

  return useQuery({
    queryKey: [
      'route-legs',
      pickup?.lat?.toFixed?.(5), pickup?.lng?.toFixed?.(5),
      dropoff?.lat?.toFixed?.(5), dropoff?.lng?.toFixed?.(5),
    ],
    enabled,
    staleTime: 60 * 60 * 1000, // roads don't move; the server caches for 24h anyway
    retry: 1,
    queryFn: async (): Promise<RouteLegs | null> => {
      const hq = closestMajorCity(at(pickup));
      const { data, error } = await supabase.functions.invoke('routes-distance', {
        body: {
          origin: { lat: hq.lat, lng: hq.lng },
          waypoint: at(pickup),
          destination: at(dropoff),
        },
      });
      if (error) return null;

      const legs = (data as any)?.legs as
        | { distanceKm: number; durationMinutes: number }[]
        | undefined;
      // Two legs or nothing — a single-leg answer means the waypoint was
      // dropped, and splitting a total back into two is exactly the guesswork
      // this replaces.
      if (!legs || legs.length < 2) return null;

      return {
        hqToPickupKm: legs[0].distanceKm,
        hqToPickupMinutes: legs[0].durationMinutes,
        pickupToDropoffKm: legs[1].distanceKm,
        pickupToDropoffMinutes: legs[1].durationMinutes,
        source: String((data as any)?.source ?? 'unknown'),
      };
    },
  });
}
