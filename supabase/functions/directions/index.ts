// =============================================================================
// POST /directions
//
// Returns a ROAD-FOLLOWING route between two points for the in-app map, so the
// pickup→dropoff line traces streets instead of a straight "as-the-crow-flies"
// segment. Backed by the Google Routes API (computeRoutes) with an encoded
// polyline field mask — the SAME service, key, budget and kill-switch as the
// pricing engine's routes-distance function:
//   1. requireAuth
//   2. per-user + per-ip rate limits
//   3. api_cache_get                       — 7-day cache (roads are static)
//   4. api_budget_check('google_routes')   — daily cap + google_routes_enabled flag
//   5. GOOGLE_MAPS_SERVER_KEY present
//   6. computeRoutes with routes.polyline.encodedPolyline
//
// When ANY guard trips (flag off, budget blown, key/API missing) it returns a
// non-2xx and the client keeps the straight-line segment, so the map always
// renders. Enable road-following by turning on the Routes API in Google Cloud
// and flipping feature_flags.google_routes_enabled = true.
//
// Response: { ok, source, polyline (Google encoded), distance_m, duration_s }.
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
});

// computeRoutes basic SKU — $5 / 1000 requests. Polyline is included in basic.
const COST_GOOGLE_ROUTES = 0.005;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    const ip = clientIp(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:directions_min`,
      endpoint: 'directions',
      limit: 30, windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `user:${user.id}:directions_day`,
      endpoint: 'directions',
      limit: 300, windowSeconds: 86_400,
    });
    await checkRateLimit({
      bucketKey: `ip:${ip}:directions_min`,
      endpoint: 'directions',
      limit: 60, windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const k = (n: number) => n.toFixed(5);
    const o = parsed.data.origin;
    const d = parsed.data.destination;

    const admin = adminClient();

    // ---- Cache (roads don't move — a route between two fixed points is stable) --
    const cacheKey = await sha256(`dirpoly:${k(o.lat)},${k(o.lng)}->${k(d.lat)},${k(d.lng)}`);
    const { data: cached } = await admin.rpc('api_cache_get', { p_key: cacheKey });
    if (cached) {
      await admin.rpc('api_log_call', {
        p_service: 'google_routes',
        p_endpoint: 'computeRoutes.polyline',
        p_profile_id: user.id,
        p_ip: ip,
        p_cost_usd: 0,
        p_cache_hit: true,
      });
      return jsonResponse({ ok: true, source: 'cache', ...cached }, { status: 200 }, cors);
    }

    // ---- Budget + flag + key check -----------------------------------------
    const { data: budgetRes } = await admin.rpc('api_budget_check', {
      p_service: 'google_routes',
      p_est_cost_usd: COST_GOOGLE_ROUTES,
    });
    const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
    if (!googleKey) throw httpError(502, 'Directions unavailable');
    if (budgetRes?.allowed !== true) throw httpError(429, 'Road routing is off or over budget');

    const res = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleKey,
          'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
          destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
          travelMode: 'DRIVE',
          units: 'METRIC',
        }),
      },
    );
    if (!res.ok) {
      console.warn('[directions] routes api', res.status, await res.text());
      throw httpError(502, 'No route available');
    }
    const json = await res.json();
    const route = json?.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!route || !encoded) throw httpError(502, 'No route available');

    const seconds = Number(String(route.duration ?? '0').replace(/[^\d]/g, '')) || null;
    const payload = {
      polyline: encoded as string,
      distance_m: route.distanceMeters ?? null,
      duration_s: seconds,
    };

    // Cache 7 days — road networks are effectively static at this granularity.
    await admin.rpc('api_cache_set', {
      p_key: cacheKey,
      p_service: 'google_routes',
      p_query_hash: cacheKey.slice(0, 32),
      p_response: payload,
      p_ttl_seconds: 7 * 86_400,
    });
    await admin.rpc('api_log_call', {
      p_service: 'google_routes',
      p_endpoint: 'computeRoutes.polyline',
      p_profile_id: user.id,
      p_ip: ip,
      p_cost_usd: COST_GOOGLE_ROUTES,
      p_cache_hit: false,
    });

    return jsonResponse({ ok: true, source: 'google', ...payload }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[directions] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
