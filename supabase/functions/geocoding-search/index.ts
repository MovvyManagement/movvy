// POST /geocoding-search
// Address autocomplete with COST PROTECTION baked in.
//
// Defense layers:
//   1. A signed-in user, or a visitor on one of Movvy's own sites (no anonymous spam)
//   2. Per-user rate limit (30/min, 200/day)
//   3. Per-IP rate limit (50/min, 2000/day)
//   4. Cache check — same query in last 1h = 0 paid calls
//   5. Budget check — if today's spend > daily cap, fall back to free Nominatim
//   6. Feature flag — if google_places_enabled = false, fall back to free Nominatim
//   7. Google call with city-bounded query + restricted key
//   8. Cache the response (1h TTL)
//   9. Log the cost to api_spend_log
//
// Result: predictable spend that can never exceed your daily cap, even under attack.
//
// SPEED: this runs on every keystroke, so the checks above run side by side
// instead of one after another, and the two writes (8, 9) finish after the
// reply has gone out. Nothing is skipped: a request over its limit is still
// rejected before any paid call is made. The Server-Timing response header
// shows how long each stage took.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, peekSession, verifySession,
} from '../_shared/security.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  query: z.string().trim().min(3).max(120),
  // Pass a city slug to constrain to that city's bounds, OR pass 'province' to
  // search across all of Alberta. Default = Alberta-wide.
  city_slug: z.string().min(1).max(40).optional(),
  province: z.enum(['AB']).optional(),
});

// Loose box covering inhabited Alberta — matches public.alberta_bounds() in SQL.
const ALBERTA_BOUNDS = { n: 60.0, s: 49.0, e: -110.0, w: -120.0 };

// Per-call cost estimates (USD). Update if Google raises prices.
const COST_GOOGLE_AUTOCOMPLETE = 0.00283;  // $2.83 / 1000 (Session-token pricing)
const COST_NOMINATIM = 0;                  // free, no key

// "Places API (New)" and the legacy "Places API" are separate console APIs.
// When New is switched off for our key it answers 403 on every call, so this
// warm instance skips it for a while instead of paying that failed round trip
// on every search.
const PLACES_NEW_RETRY_MS = 10 * 60 * 1000;
let skipPlacesNewUntil = 0;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  const timing = stopwatch();
  try {
    const ip = clientIp(req);

    // The website asks for addresses before the visitor has an account, so a
    // visitor is allowed in from Movvy's own sites only, on tighter limits.
    // `known` is null for such a visitor, and undefined for a session that
    // still has to be verified. Strangers are turned away right here, before
    // any database work is started on their behalf.
    const known = peekSession(req);
    if (known === null && !isAllowedOrigin(req)) throw httpError(401, 'Missing Authorization header');

    // Read the body first so the cache and budget lookups can run alongside
    // the session check and the rate limits. A bad body is still only rejected
    // after the limits below have counted the request, exactly as before.
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const admin = adminClient();

    // Alberta-wide searches (what the app and website send) already know their
    // cache key, so start the cache read and budget check now. Neither one
    // changes anything a caller could notice (the cache read only bumps a hit
    // counter), and their answers are only used once the limits pass.
    let earlyCacheKey: string | null = null;
    let earlyCache: Promise<{ data: unknown }> | null = null;
    let earlyBudget: Promise<{ data: any }> | null = null;
    if (parsed.success && !parsed.data.city_slug) {
      const earlyScope = `province:${parsed.data.province ?? 'AB'}`;
      earlyCacheKey = await sha256(`autocomplete:${earlyScope}:${parsed.data.query.toLowerCase()}`);
      earlyCache = startRpc(admin.rpc('api_cache_get', { p_key: earlyCacheKey }));
      earlyBudget = startRpc(admin.rpc('api_budget_check', {
        p_service: 'google_places',
        p_est_cost_usd: COST_GOOGLE_AUTOCOMPLETE,
      }));
    }

    // A session verified in the last minute is used as is; otherwise it is
    // verified now, while the two lookups above are already on their way.
    const user = known !== undefined ? known : await verifySession(req);
    timing.mark('auth');

    // ---- Rate limits (multi-axis) ------------------------------------------
    // All four buckets are checked at once instead of one after another. Any
    // one of them over its limit still rejects the request with a 429.
    await Promise.all([
      // Tight per-user limit prevents one bad actor from costing $$
      checkRateLimit({
        bucketKey: user ? `user:${user.id}:geocoding_search_min` : `visitor:${ip}:geocoding_search_min`,
        endpoint: 'geocoding-search',
        limit: user ? 30 : 20, windowSeconds: 60,
      }),
      checkRateLimit({
        bucketKey: user ? `user:${user.id}:geocoding_search_day` : `visitor:${ip}:geocoding_search_day`,
        endpoint: 'geocoding-search',
        limit: user ? 200 : 150, windowSeconds: 86400,
      }),
      // Wider per-IP limit catches multi-account abuse
      checkRateLimit({
        bucketKey: `ip:${ip}:geocoding_search_min`,
        endpoint: 'geocoding-search',
        limit: 50, windowSeconds: 60,
      }),
      checkRateLimit({
        bucketKey: `ip:${ip}:geocoding_search_day`,
        endpoint: 'geocoding-search',
        limit: 2000, windowSeconds: 86400,
      }),
    ]);
    timing.mark('limits');

    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { query, city_slug, province } = parsed.data;

    // ---- Decide bounding box: city-specific OR Alberta-wide ----------------
    let bounds: { n: number; s: number; e: number; w: number };
    let scope: string;

    if (city_slug) {
      const { data: city, error: cityErr } = await admin
        .from('cities')
        .select('slug, is_active, bounds_n, bounds_s, bounds_e, bounds_w')
        .eq('slug', city_slug).single();
      if (cityErr || !city) throw httpError(400, 'Unknown city');
      if (!city.is_active) throw httpError(403, 'City not active');
      bounds = { n: city.bounds_n, s: city.bounds_s, e: city.bounds_e, w: city.bounds_w };
      scope = `city:${city.slug}`;
    } else {
      // Default: Alberta-wide
      bounds = ALBERTA_BOUNDS;
      scope = `province:${province ?? 'AB'}`;
    }

    // ---- Cache check -------------------------------------------------------
    const cacheKey = earlyCacheKey ?? await sha256(`autocomplete:${scope}:${query.toLowerCase()}`);
    const { data: cached } = await (earlyCache ?? startRpc(admin.rpc('api_cache_get', { p_key: cacheKey })));
    timing.mark('cache');
    if (cached) {
      // The log row is written after the reply goes out, not before it.
      afterResponse(admin.rpc('api_log_call', {
        p_service: 'google_places',
        p_endpoint: 'autocomplete',
        p_profile_id: user?.id ?? null,
        p_ip: ip,
        p_cost_usd: 0,
        p_cache_hit: true,
      }));
      return jsonResponse(
        { ok: true, source: 'cache', results: cached },
        { status: 200 },
        { ...cors, 'Server-Timing': timing.header() },
      );
    }

    // ---- Budget + feature flag check ---------------------------------------
    const { data: budgetRes } = await (earlyBudget ?? startRpc(admin.rpc('api_budget_check', {
      p_service: 'google_places',
      p_est_cost_usd: COST_GOOGLE_AUTOCOMPLETE,
    })));
    const useGoogle = budgetRes?.allowed === true && !!Deno.env.get('GOOGLE_MAPS_SERVER_KEY');

    let results: any[] = [];
    let source: 'google' | 'nominatim' = 'nominatim';
    let costUsd = 0;
    let api = 'nominatim';

    if (useGoogle) {
      try {
        const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')!;
        // Keep the AB/Alberta text filter as defence in depth on top of the
        // bounds restriction, the bookings-create server check, and the
        // Nominatim viewbox.
        const inAlberta = (main: string, secondary: string): boolean =>
          /\bAB\b|\bAlberta\b/.test(`${main} ${secondary}`);

        // "Places API (New)" and the legacy "Places API" are SEPARATE console
        // APIs — a project may have either enabled. Try New first (go-forward),
        // fall back to legacy. Normalized prediction: { placeId, main, secondary }.
        let preds: Array<{ placeId: string; main: string; secondary: string }> | null = null;

        // New: POST places:autocomplete. locationRestriction.rectangle HARD-
        // bounds to Alberta (the old circular radius leaked into BC/SK).
        let useLegacy = Date.now() < skipPlacesNewUntil;
        if (!useLegacy) {
          const rNew = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey },
            body: JSON.stringify({
              input: query,
              includedRegionCodes: ['ca'],
              locationRestriction: {
                rectangle: {
                  low: { latitude: bounds.s, longitude: bounds.w },
                  high: { latitude: bounds.n, longitude: bounds.e },
                },
              },
            }),
          });
          const jNew = await rNew.json().catch(() => ({}));
          // New answers {} when nothing matches, which is a real answer, not
          // a reason to pay for a second search on the legacy API.
          if (rNew.ok) {
            preds = (Array.isArray(jNew.suggestions) ? jNew.suggestions : [])
              .map((s: any) => s.placePrediction)
              .filter((p: any) => p?.placeId)
              .map((p: any) => ({
                placeId: p.placeId,
                main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
                secondary: p.structuredFormat?.secondaryText?.text ?? '',
              }));
            api = 'places-new';
          } else {
            console.warn('[geocoding] places(new) unavailable, trying legacy',
              rNew.status, jNew?.error?.status ?? jNew?.error?.message ?? '');
            if (rNew.status === 403) skipPlacesNewUntil = Date.now() + PLACES_NEW_RETRY_MS;
            useLegacy = true;
          }
        }
        if (useLegacy) {
          // Legacy: GET place/autocomplete/json. strictbounds + a wide radius
          // approximates the Alberta box; the AB text filter cleans the edges.
          const rLeg = await fetch(
            `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
            `?input=${encodeURIComponent(query)}` +
            `&components=country:ca` +
            `&location=${(bounds.n + bounds.s) / 2},${(bounds.e + bounds.w) / 2}` +
            `&radius=${city_slug ? 25000 : 400000}` +
            `&strictbounds=true` +
            `&key=${googleKey}`,
          );
          const jLeg = await rLeg.json();
          if (jLeg.status === 'OK' || jLeg.status === 'ZERO_RESULTS') {
            preds = (jLeg.predictions ?? []).map((p: any) => ({
              placeId: p.place_id,
              main: p.structured_formatting?.main_text ?? p.description ?? '',
              secondary: p.structured_formatting?.secondary_text ?? '',
            }));
            api = 'places-legacy';
          } else {
            console.warn('[geocoding] legacy autocomplete failed', jLeg.status, jLeg.error_message ?? '');
          }
        }

        if (preds) {
          results = preds
            .filter((p) => p.placeId && inAlberta(p.main, p.secondary))
            .slice(0, 6)
            .map((p) => ({ id: p.placeId, label: p.main, secondary: p.secondary, place_id: p.placeId }));
          source = 'google';
          costUsd = COST_GOOGLE_AUTOCOMPLETE;
        }
      } catch (e) {
        console.error('[geocoding] google call failed, falling back', e);
      }
    }

    if (source !== 'google') {
      api = 'nominatim';
      results = await nominatimSearch(query, bounds);
    }
    timing.mark(api);

    // ---- Cache + log -------------------------------------------------------
    // Both writes still always happen; they just finish after the reply is
    // sent, so the visitor isn't waiting on two more database round trips.
    afterResponse(Promise.all([
      admin.rpc('api_cache_set', {
        p_key: cacheKey,
        p_service: source === 'google' ? 'google_places' : 'nominatim',
        p_query_hash: query.toLowerCase().slice(0, 80),
        p_response: results,
        p_ttl_seconds: source === 'google' ? 3600 : 600,  // 1h for paid, 10min for free
      }),
      admin.rpc('api_log_call', {
        p_service: source === 'google' ? 'google_places' : 'nominatim',
        p_endpoint: 'autocomplete',
        p_profile_id: user?.id ?? null,
        p_ip: ip,
        p_cost_usd: costUsd,
        p_cache_hit: false,
        p_metadata: { query_length: query.length, scope },
      }),
    ]));

    return jsonResponse(
      { ok: true, source, results, budget: budgetRes },
      { status: 200 },
      { ...cors, 'Server-Timing': timing.header() },
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[geocoding-search] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// ---- Helpers --------------------------------------------------------------

/** Times each stage of a request for the Server-Timing response header. */
function stopwatch() {
  const start = performance.now();
  let last = start;
  const parts: string[] = [];
  return {
    mark(name: string) {
      const now = performance.now();
      parts.push(`${name};dur=${Math.round(now - last)}`);
      last = now;
    },
    header() {
      return [...parts, `total;dur=${Math.round(performance.now() - start)}`].join(', ');
    },
  };
}

/**
 * Supabase query builders don't send anything until awaited. This starts one
 * right away so it can run alongside other work, and never rejects.
 */
function startRpc<T = any>(builder: PromiseLike<{ data: T }>): Promise<{ data: T | null }> {
  return Promise.resolve(builder).catch((e) => {
    console.error('[geocoding-search] lookup failed', e);
    return { data: null };
  });
}

/** Let a write finish after the response is sent (Supabase background task). */
function afterResponse(work: PromiseLike<unknown>): void {
  const done = Promise.resolve(work)
    .then((res: any) => {
      for (const r of Array.isArray(res) ? res : [res]) {
        if (r?.error) console.error('[geocoding-search] background write failed', r.error);
      }
    })
    .catch((e) => console.error('[geocoding-search] background write failed', e));
  // @ts-ignore — EdgeRuntime exists on Supabase's edge runtime
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    // @ts-ignore
    EdgeRuntime.waitUntil(done);
  }
}

async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function nominatimSearch(query: string, bounds: { n: number; s: number; e: number; w: number }) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '6',
    viewbox: `${bounds.w},${bounds.n},${bounds.e},${bounds.s}`,
    bounded: '1',
    countrycodes: 'ca',
  });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Movvy-Server/0.1 (https://movvy.ca)',
    },
  });
  if (!r.ok) return [];
  const json = await r.json();
  if (!Array.isArray(json)) return [];
  return json
    .filter((r: any) => r?.lat && r?.lon)
    .map((r: any, i: number) => {
      const a = r.address ?? {};
      const houseNumber = a.house_number ? `${a.house_number} ` : '';
      const street = a.road ?? a.pedestrian ?? a.neighbourhood ?? '';
      const fallback = typeof r.display_name === 'string' ? r.display_name.split(',')[0] : 'Address';
      const label = `${houseNumber}${street}`.trim() || fallback;
      const secondary = [a.suburb, a.city ?? a.town, a.postcode].filter(Boolean).join(' · ');
      return {
        id: String(r.place_id ?? `${r.lat}-${r.lon}-${i}`),
        label,
        secondary,
        lat: Number(r.lat),
        lng: Number(r.lon),
      };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}
