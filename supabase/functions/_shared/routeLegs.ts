// =============================================================================
// measureRouteLegs — the two driving legs a quote is built from, measured on
// the SERVER, where the price is decided.
//
//   leg 1  HQ → pickup
//   leg 2  pickup → drop-off
//
// Both are billed time, and leg 2's distance flips the 100 km round-trip rule,
// so these numbers are the price. The client fetches the same figures for its
// preview, but the booking must never take the client's word for it — a
// distance supplied by the caller is a distance the caller can shrink.
//
// Cached in api_cache for 24h keyed on the rounded coordinates, so the
// customer's preview call usually pays for the lookup and the booking call
// rides free. Falls back to haversine × 1.30 at 80 km/h whenever the key,
// budget or feature flag is missing — the same approximation the pricing
// engine uses when handed nothing, so a failure here is a loss of accuracy,
// never a failure to quote.
// =============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export interface Coord { lat: number; lng: number }

export interface RouteLegs {
  hqToPickupKm: number;
  hqToPickupMinutes: number;
  pickupToDropoffKm: number;
  pickupToDropoffMinutes: number;
  source: 'google' | 'haversine';
}

const COST_GOOGLE_ROUTES = 0.005;
const ROAD_FUDGE = 1.30;
const AVG_KPH = 80;

async function sha256(s: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function approximate(hq: Coord, pickup: Coord, dropoff: Coord): RouteLegs {
  const leg = (a: Coord, b: Coord) => {
    const km = haversineKm(a, b) * ROAD_FUDGE;
    return { km: Math.round(km * 10) / 10, min: Math.round((km / AVG_KPH) * 60) };
  };
  const l1 = leg(hq, pickup);
  const l2 = leg(pickup, dropoff);
  return {
    hqToPickupKm: l1.km,
    hqToPickupMinutes: l1.min,
    pickupToDropoffKm: l2.km,
    pickupToDropoffMinutes: l2.min,
    source: 'haversine',
  };
}

async function callGoogle(hq: Coord, pickup: Coord, dropoff: Coord): Promise<RouteLegs> {
  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')!;
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Per-leg figures: the two legs are billed separately with their own
      // rounding, so a single total can't be split back apart.
      'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: hq.lat, longitude: hq.lng } } },
      intermediates: [{ location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } }],
      destination: { location: { latLng: { latitude: dropoff.lat, longitude: dropoff.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      units: 'METRIC',
    }),
  });
  if (!res.ok) throw new Error(`routes ${res.status}`);
  const json = await res.json();
  const legs = json?.routes?.[0]?.legs;
  if (!Array.isArray(legs) || legs.length < 2) throw new Error('expected two legs');

  const secs = (v: unknown) => Number(String(v ?? '0').replace(/[^\d]/g, '')) || 0;
  const km = (m: unknown) => Math.round((Number(m ?? 0) / 1000) * 10) / 10;
  return {
    hqToPickupKm: km(legs[0].distanceMeters),
    hqToPickupMinutes: Math.round(secs(legs[0].duration) / 60),
    pickupToDropoffKm: km(legs[1].distanceMeters),
    pickupToDropoffMinutes: Math.round(secs(legs[1].duration) / 60),
    source: 'google',
  };
}

export async function measureRouteLegs(
  admin: SupabaseClient,
  hq: Coord,
  pickup: Coord,
  dropoff: Coord,
  profileId?: string,
): Promise<RouteLegs> {
  const k = (n: number) => n.toFixed(5);
  const cacheKey = await sha256(
    `legs.v1:${k(hq.lat)},${k(hq.lng)}->${k(pickup.lat)},${k(pickup.lng)}->${k(dropoff.lat)},${k(dropoff.lng)}`,
  );

  try {
    const { data: cached } = await admin.rpc('api_cache_get', { p_key: cacheKey });
    if (cached) return cached as RouteLegs;
  } catch { /* cache is an optimisation, never a dependency */ }

  let result = approximate(hq, pickup, dropoff);
  try {
    const { data: budget } = await admin.rpc('api_budget_check', {
      p_service: 'google_routes',
      p_est_cost_usd: COST_GOOGLE_ROUTES,
    });
    if (budget?.allowed === true && Deno.env.get('GOOGLE_MAPS_SERVER_KEY')) {
      result = await callGoogle(hq, pickup, dropoff);
      await admin.rpc('api_log_call', {
        p_service: 'google_routes',
        p_endpoint: 'computeRoutes',
        p_profile_id: profileId ?? null,
        p_cost_usd: COST_GOOGLE_ROUTES,
        p_cache_hit: false,
        p_metadata: { caller: 'bookings-create' },
      });
    }
  } catch (e) {
    console.error('[routeLegs] falling back to approximation', e);
  }

  try {
    await admin.rpc('api_cache_set', {
      p_key: cacheKey,
      p_service: result.source === 'google' ? 'google_routes' : 'haversine',
      p_query_hash: cacheKey.slice(0, 32),
      p_response: result,
      p_ttl_seconds: result.source === 'google' ? 86_400 : 600,
    });
  } catch { /* ditto */ }

  return result;
}
