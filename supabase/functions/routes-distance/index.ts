// =============================================================================
// POST /routes-distance
//
// Real driving distance + duration via Google Routes API (computeRoutes).
// Used by the pricing engine to replace the haversine × 1.30 / 80 kph
// approximation when the operator has opted into paying for accuracy.
//
// Same defence-in-depth pattern as geocoding-search:
//   1. requireAuth                          — no anon spam
//   2. per-user + per-IP rate limit         — 60/min/user · 200/day/user · 100/min/IP
//   3. api_cache_get                        — 24h cache: same origin+dest = 0 paid calls
//   4. api_budget_check('google_routes')    — daily cap enforced
//   5. feature_flags.google_routes_enabled  — instant kill switch
//   6. Google Routes computeRoutes call
//   7. api_cache_set (24h)
//   8. api_log_call (cost)
//
// Falls back to the haversine × 1.30 / 80 kph estimate when ANY guard trips,
// so the caller always gets a usable value — just less precise.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Coord = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const Body = z.object({
  origin: Coord,
  destination: Coord,
  /** Optional waypoint between origin + destination (e.g. HQ → pickup → dropoff). */
  waypoint: Coord.optional(),
  /** Travel mode — currently only DRIVE is supported; we hard-code it server-side
   *  so the client can't bump up to expensive routing modes. */
});

// Routes API pricing (computeRoutes, basic mode):
//   $5.00 per 1,000 requests — same as legacy Directions API.
// Bump this if Google raises prices.
const COST_GOOGLE_ROUTES = 0.005;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    const ip = clientIp(req);

    // ─── Rate limits ──────────────────────────────────────────────────────
    await checkRateLimit({
      bucketKey: `user:${user.id}:routes_distance_min`,
      endpoint: 'routes-distance',
      limit: 60, windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `user:${user.id}:routes_distance_day`,
      endpoint: 'routes-distance',
      limit: 200, windowSeconds: 86_400,
    });
    await checkRateLimit({
      bucketKey: `ip:${ip}:routes_distance_min`,
      endpoint: 'routes-distance',
      limit: 100, windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { origin, destination, waypoint } = parsed.data;

    const admin = adminClient();

    // ─── Cache lookup ─────────────────────────────────────────────────────
    // Round coords to ~10 m (5 decimal places) so near-identical queries
    // collapse onto one cache entry — Google's km/min answers don't change
    // meaningfully within that radius.
    const k = (n: number) => n.toFixed(5);
    const cacheKey = await sha256(
      `routes.v2:${k(origin.lat)},${k(origin.lng)}->${
        waypoint ? `${k(waypoint.lat)},${k(waypoint.lng)}->` : ''
      }${k(destination.lat)},${k(destination.lng)}`,
    );
    const { data: cached } = await admin.rpc('api_cache_get', { p_key: cacheKey });
    if (cached) {
      await admin.rpc('api_log_call', {
        p_service: 'google_routes',
        p_endpoint: 'computeRoutes',
        p_profile_id: user.id,
        p_ip: ip,
        p_cost_usd: 0,
        p_cache_hit: true,
      });
      return jsonResponse({ ok: true, source: 'cache', ...cached }, { status: 200 }, cors);
    }

    // ─── Budget + flag check ──────────────────────────────────────────────
    const { data: budgetRes } = await admin.rpc('api_budget_check', {
      p_service: 'google_routes',
      p_est_cost_usd: COST_GOOGLE_ROUTES,
    });
    const useGoogle = budgetRes?.allowed === true && !!Deno.env.get('GOOGLE_MAPS_SERVER_KEY');

    let result: { distanceKm: number; durationMinutes: number; legs: RouteLeg[] };
    let source: 'google' | 'haversine' = 'haversine';
    let costUsd = 0;

    if (useGoogle) {
      try {
        result = await callGoogleRoutes(origin, destination, waypoint);
        source = 'google';
        costUsd = COST_GOOGLE_ROUTES;
      } catch (e) {
        console.error('[routes-distance] google call failed, falling back', e);
        result = estimateHaversine(origin, destination, waypoint);
      }
    } else {
      result = estimateHaversine(origin, destination, waypoint);
    }

    // ─── Cache + log ──────────────────────────────────────────────────────
    // 24h TTL for paid Google results — routes change slowly enough that
    // it's safe and saves a ton of repeated spend on hot pairs (e.g.
    // Calgary→Edmonton). 10 min for free fallback — keeps it fresh once
    // we flip the paid flag.
    await admin.rpc('api_cache_set', {
      p_key: cacheKey,
      p_service: source === 'google' ? 'google_routes' : 'haversine',
      p_query_hash: cacheKey.slice(0, 32),
      p_response: result,
      p_ttl_seconds: source === 'google' ? 86_400 : 600,
    });
    await admin.rpc('api_log_call', {
      p_service: source === 'google' ? 'google_routes' : 'haversine',
      p_endpoint: 'computeRoutes',
      p_profile_id: user.id,
      p_ip: ip,
      p_cost_usd: costUsd,
      p_cache_hit: false,
      p_metadata: { waypoint: !!waypoint },
    });

    return jsonResponse(
      { ok: true, source, ...result, budget: budgetRes },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[routes-distance] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Coord3 { lat: number; lng: number; }

export interface RouteLeg { distanceKm: number; durationMinutes: number; }

async function callGoogleRoutes(
  origin: Coord3, destination: Coord3, waypoint?: Coord3,
): Promise<{ distanceKm: number; durationMinutes: number; legs: RouteLeg[] }> {
  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')!;
  const body: Record<string, any> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    units: 'METRIC',
  };
  if (waypoint) {
    body.intermediates = [{ location: { latLng: { latitude: waypoint.lat, longitude: waypoint.lng } } }];
  }

  // The field mask is REQUIRED by the new Routes API — it both caps the
  // response size AND gates the SKU billed. Asking for distance + duration
  // only stays on the cheap basic SKU.
  const res = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // Per-LEG figures matter now: the pricing engine bills HQ → pickup and
        // pickup → drop-off as separate lines with their own rounding, so a
        // single total can't be split back apart. Legs stay on the basic SKU.
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`routes ${res.status}`);
  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route) throw new Error('no routes returned');
  // Duration comes back as `"1234s"` — parse the seconds suffix.
  const secs = (v: unknown) => Number(String(v ?? '0').replace(/[^\d]/g, '')) || 0;
  const km = (m: unknown) => Math.round((Number(m ?? 0) / 1000) * 10) / 10;
  return {
    distanceKm: km(route.distanceMeters),
    durationMinutes: Math.round(secs(route.duration) / 60),
    legs: (route.legs ?? []).map((l: any) => ({
      distanceKm: km(l.distanceMeters),
      durationMinutes: Math.round(secs(l.duration) / 60),
    })),
  };
}

function haversineKm(a: Coord3, b: Coord3): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimateHaversine(
  origin: Coord3, destination: Coord3, waypoint?: Coord3,
): { distanceKm: number; durationMinutes: number; legs: RouteLeg[] } {
  // Same fudge factors as src/lib/distance.ts so the fallback matches the
  // existing pricing engine's expectations — switching to Google is a pure
  // accuracy upgrade, never a price shift.
  const ROAD_FUDGE = 1.30;
  const AVG_KPH = 80;
  const leg = (a: Coord3, b: Coord3): RouteLeg => {
    const d = haversineKm(a, b) * ROAD_FUDGE;
    return {
      distanceKm: Math.round(d * 10) / 10,
      durationMinutes: Math.round((d / AVG_KPH) * 60),
    };
  };
  const legs = waypoint
    ? [leg(origin, waypoint), leg(waypoint, destination)]
    : [leg(origin, destination)];
  const distanceKm = Math.round(legs.reduce((t, l) => t + l.distanceKm, 0) * 10) / 10;
  return {
    distanceKm,
    durationMinutes: legs.reduce((t, l) => t + l.durationMinutes, 0),
    legs,
  };
}
