// POST /place-details
//
// Resolves a Google Places `place_id` (from the autocomplete predictions
// returned by /geocoding-search) into real coordinates + a settlement name.
//
// WHY THIS EXISTS: Google Places Autocomplete predictions carry NO lat/lng —
// only a place_id + display strings. Our whole booking flow needs coordinates
// (pricing distance, map pins, city/province routing). Nominatim results already
// include lat/lng, so this resolver is only invoked when the user picks a
// *Google* suggestion. One paid Place Details call per selection is the standard
// cost-optimal pattern (autocomplete is cheap; details is charged per accepted
// pick, not per keystroke).
//
// Same defence-in-depth as geocoding-search / routes-distance. As there, the
// checks run side by side and the two writes finish after the reply has gone
// out, so a pick resolves quickly; nothing is skipped.
//   1. signed-in user, or a visitor on one of Movvy's own sites — no anon spam
//   2. per-user + per-IP rate limit
//   3. api_cache_get                        — same place_id in last 24h = 0 paid calls
//   4. api_budget_check('google_places')    — daily cap enforced (shared w/ autocomplete)
//   5. GOOGLE_MAPS_SERVER_KEY present        — else 502 (a Google place_id can only
//                                              be resolved by Google)
//   6. Google Place Details call (geometry + address_component only)
//   7. api_cache_set (24h — a place's coords never change)
//   8. api_log_call (cost)

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, peekSession, verifySession,
} from '../_shared/security.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  // Google place_ids are opaque tokens; keep the bound loose but sane.
  place_id: z.string().trim().min(4).max(512),
});

// Place Details (Basic Data SKU — geometry + address components).
// $17 / 1000 requests. Bump if Google raises prices.
const COST_GOOGLE_DETAILS = 0.017;

// Loose box covering inhabited Alberta — matches geocoding-search + SQL.
const ALBERTA_BOUNDS = { n: 60.0, s: 49.0, e: -110.0, w: -120.0 };

// When Places API (New) is switched off for our key it answers 403 every time,
// so this warm instance goes straight to the legacy API for a while instead of
// paying that failed round trip on every pick.
const PLACES_NEW_RETRY_MS = 10 * 60 * 1000;
let skipPlacesNewUntil = 0;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  const timing = stopwatch();
  try {
    const ip = clientIp(req);

    // Same visitor rule as geocoding-search: Movvy's own sites only, tighter.
    // `known` is null for a visitor and undefined for a session that still has
    // to be verified. Strangers are turned away before any database work.
    const known = peekSession(req);
    if (known === null && !isAllowedOrigin(req)) throw httpError(401, 'Missing Authorization header');

    // Read the body first so the cache and budget lookups can run alongside
    // the session check and the rate limits. A bad body is still only rejected
    // after the limits below have counted the request, exactly as before.
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const admin = adminClient();

    // ---- Cache + budget lookups, started early ------------------------------
    // Neither one changes anything a caller could notice (the cache read only
    // bumps a hit counter), and their answers are only used once the limits pass.
    let cacheKey: string | null = null;
    let cacheLookup: Promise<{ data: unknown }> | null = null;
    let budgetLookup: Promise<{ data: any }> | null = null;
    if (parsed.success) {
      // 24h cache — coordinates for a place_id are immutable.
      cacheKey = await sha256(`placedetails:${parsed.data.place_id}`);
      cacheLookup = startRpc(admin.rpc('api_cache_get', { p_key: cacheKey }));
      budgetLookup = startRpc(admin.rpc('api_budget_check', {
        p_service: 'google_places',
        p_est_cost_usd: COST_GOOGLE_DETAILS,
      }));
    }

    // A session verified in the last minute (usually by the address search the
    // customer just did) is used as is; otherwise it is verified now.
    const user = known !== undefined ? known : await verifySession(req);
    timing.mark('auth');

    // ---- Rate limits -------------------------------------------------------
    // All three buckets are checked at once instead of one after another. Any
    // one of them over its limit still rejects the request with a 429.
    await Promise.all([
      checkRateLimit({
        bucketKey: user ? `user:${user.id}:place_details_min` : `visitor:${ip}:place_details_min`,
        endpoint: 'place-details',
        limit: user ? 30 : 20, windowSeconds: 60,
      }),
      checkRateLimit({
        bucketKey: user ? `user:${user.id}:place_details_day` : `visitor:${ip}:place_details_day`,
        endpoint: 'place-details',
        limit: user ? 200 : 60, windowSeconds: 86_400,
      }),
      checkRateLimit({
        bucketKey: `ip:${ip}:place_details_min`,
        endpoint: 'place-details',
        limit: 50, windowSeconds: 60,
      }),
    ]);
    timing.mark('limits');

    if (!parsed.success || !cacheKey || !cacheLookup || !budgetLookup) {
      throw httpError(400, (!parsed.success && parsed.error.issues[0]?.message) || 'Invalid input');
    }
    const { place_id } = parsed.data;

    // ---- Cache check -------------------------------------------------------
    const { data: cached } = await cacheLookup;
    timing.mark('cache');
    if (cached) {
      // The log row is written after the reply goes out, not before it.
      afterResponse(admin.rpc('api_log_call', {
        p_service: 'google_places',
        p_endpoint: 'details',
        p_profile_id: user?.id ?? null,
        p_ip: ip,
        p_cost_usd: 0,
        p_cache_hit: true,
      }));
      return jsonResponse(
        { ok: true, source: 'cache', result: cached },
        { status: 200 },
        { ...cors, 'Server-Timing': timing.header() },
      );
    }

    // ---- Budget + key check ------------------------------------------------
    const { data: budgetRes } = await budgetLookup;
    const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
    // Unlike autocomplete, there is NO free fallback: only Google can resolve a
    // Google place_id. If the budget is blown or the key is missing we surface a
    // clear 502 so the client keeps the free Nominatim path instead.
    if (!googleKey) throw httpError(502, 'Place resolver unavailable');
    if (budgetRes?.allowed !== true) throw httpError(429, 'Daily map budget reached — try again tomorrow');

    // ---- Google Place Details (prefer New, fall back to legacy) ------------
    // "Places API (New)" and the legacy "Places API" are SEPARATE APIs in the
    // Cloud console; a project may have either enabled. Try New first (the
    // go-forward API), fall back to legacy so resolution works whichever is on.
    // Both are normalized into: lat/lng + comps[{longText,shortText,types}].
    let lat = NaN;
    let lng = NaN;
    let comps: Array<{ longText?: string; shortText?: string; types: string[] }> = [];
    let formattedAddress: string | undefined;
    let displayName: string | undefined;

    // New: GET /v1/places/{placeId} with a field mask (cheap Basic-Data SKU).
    let useLegacy = Date.now() < skipPlacesNewUntil;
    if (!useLegacy) {
      const rNew = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}`,
        {
          headers: {
            'X-Goog-Api-Key': googleKey,
            'X-Goog-FieldMask': 'location,addressComponents,formattedAddress,displayName',
          },
        },
      );
      const jNew = await rNew.json().catch(() => ({}));
      if (rNew.ok && jNew.location) {
        lat = Number(jNew.location.latitude);
        lng = Number(jNew.location.longitude);
        comps = (jNew.addressComponents ?? []).map((c: any) => ({
          longText: c.longText, shortText: c.shortText, types: c.types ?? [],
        }));
        formattedAddress = jNew.formattedAddress;
        displayName = jNew.displayName?.text;
      } else {
        console.warn('[place-details] places(new) unavailable, trying legacy',
          rNew.status, jNew?.error?.status ?? jNew?.error?.message ?? '');
        if (rNew.status === 403) skipPlacesNewUntil = Date.now() + PLACES_NEW_RETRY_MS;
        useLegacy = true;
      }
    }
    if (useLegacy) {
      // Legacy: GET place/details/json (fields → Basic Data SKU).
      const rLeg = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(place_id)}` +
        `&fields=${encodeURIComponent('geometry/location,address_component,formatted_address,name')}` +
        `&key=${googleKey}`,
      );
      const jLeg = await rLeg.json();
      if (jLeg.status === 'OK' && jLeg.result?.geometry?.location) {
        lat = Number(jLeg.result.geometry.location.lat);
        lng = Number(jLeg.result.geometry.location.lng);
        comps = (jLeg.result.address_components ?? []).map((c: any) => ({
          longText: c.long_name, shortText: c.short_name, types: c.types ?? [],
        }));
        formattedAddress = jLeg.result.formatted_address;
        displayName = jLeg.result.name;
      } else {
        console.warn('[place-details] legacy failed', jLeg.status, jLeg.error_message ?? '');
      }
    }

    timing.mark(useLegacy ? 'places-legacy' : 'places-new');

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw httpError(422, 'Could not resolve that address');
    }

    // Reject anything outside Alberta — Movvy is Alberta-only, and defence in
    // depth on top of the autocomplete post-filter + bookings-create check.
    const inAlberta =
      lat >= ALBERTA_BOUNDS.s && lat <= ALBERTA_BOUNDS.n &&
      lng >= ALBERTA_BOUNDS.w && lng <= ALBERTA_BOUNDS.e;
    if (!inAlberta) throw httpError(422, 'That address is outside our service area');

    // Flatten the normalized address components into the {city, state, ...}
    // shape our client's cityProvinceFromGeocode() already understands (it
    // reads raw.address.{city,town,state,...}). locality → city; AAL1 → state.
    const pick = (type: string, short = false) => {
      const c = comps.find((x) => x.types?.includes(type));
      return c ? (short ? c.shortText : c.longText) : undefined;
    };
    const streetNumber = pick('street_number');
    const route = pick('route');
    const city =
      pick('locality') ?? pick('postal_town') ??
      pick('administrative_area_level_2') ?? pick('sublocality');
    const address = {
      house_number: streetNumber,
      road: route,
      city,
      town: city,
      state: pick('administrative_area_level_1', true), // "AB"
      postcode: pick('postal_code'),
      country_code: (pick('country', true) ?? '').toLowerCase(),
    };

    const label =
      [streetNumber, route].filter(Boolean).join(' ').trim() ||
      displayName ||
      (formattedAddress ?? '').split(',')[0] ||
      'Address';
    const secondary = [address.city, address.postcode].filter(Boolean).join(' · ');

    const result = {
      id: place_id,
      place_id,
      label,
      secondary,
      lat,
      lng,
      raw: { address, formatted_address: formattedAddress },
    };

    // ---- Cache (24h) + log -------------------------------------------------
    // Both writes still always happen; they just finish after the reply is
    // sent, so the customer isn't waiting on two more database round trips.
    afterResponse(Promise.all([
      admin.rpc('api_cache_set', {
        p_key: cacheKey,
        p_service: 'google_places',
        p_query_hash: place_id.slice(0, 80),
        p_response: result,
        p_ttl_seconds: 86_400,
      }),
      admin.rpc('api_log_call', {
        p_service: 'google_places',
        p_endpoint: 'details',
        p_profile_id: user?.id ?? null,
        p_ip: ip,
        p_cost_usd: COST_GOOGLE_DETAILS,
        p_cache_hit: false,
      }),
    ]));

    return jsonResponse(
      { ok: true, source: 'google', result },
      { status: 200 },
      { ...cors, 'Server-Timing': timing.header() },
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[place-details] unhandled', e);
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
    console.error('[place-details] lookup failed', e);
    return { data: null };
  });
}

/** Let a write finish after the response is sent (Supabase background task). */
function afterResponse(work: PromiseLike<unknown>): void {
  const done = Promise.resolve(work)
    .then((res: any) => {
      for (const r of Array.isArray(res) ? res : [res]) {
        if (r?.error) console.error('[place-details] background write failed', r.error);
      }
    })
    .catch((e) => console.error('[place-details] background write failed', e));
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
