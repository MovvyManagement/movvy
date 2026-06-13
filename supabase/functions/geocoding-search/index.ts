// POST /geocoding-search
// Address autocomplete with COST PROTECTION baked in.
//
// Defense layers, in order:
//   1. Auth required (no anonymous spam)
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

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
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

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    const ip = clientIp(req);

    // ---- Rate limits (multi-axis) ------------------------------------------
    // Tight per-user limit prevents one bad actor from costing $$
    await checkRateLimit({
      bucketKey: `user:${user.id}:geocoding_search_min`,
      endpoint: 'geocoding-search',
      limit: 30, windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `user:${user.id}:geocoding_search_day`,
      endpoint: 'geocoding-search',
      limit: 200, windowSeconds: 86400,
    });
    // Wider per-IP limit catches multi-account abuse
    await checkRateLimit({
      bucketKey: `ip:${ip}:geocoding_search_min`,
      endpoint: 'geocoding-search',
      limit: 50, windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `ip:${ip}:geocoding_search_day`,
      endpoint: 'geocoding-search',
      limit: 2000, windowSeconds: 86400,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { query, city_slug, province } = parsed.data;

    const admin = adminClient();

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
    const cacheKey = await sha256(`autocomplete:${scope}:${query.toLowerCase()}`);
    const { data: cached } = await admin.rpc('api_cache_get', { p_key: cacheKey });
    if (cached) {
      await admin.rpc('api_log_call', {
        p_service: 'google_places',
        p_endpoint: 'autocomplete',
        p_profile_id: user.id,
        p_ip: ip,
        p_cost_usd: 0,
        p_cache_hit: true,
      });
      return jsonResponse({ ok: true, source: 'cache', results: cached }, { status: 200 }, cors);
    }

    // ---- Budget + feature flag check ---------------------------------------
    const { data: budgetRes } = await admin.rpc('api_budget_check', {
      p_service: 'google_places',
      p_est_cost_usd: COST_GOOGLE_AUTOCOMPLETE,
    });
    const useGoogle = budgetRes?.allowed === true && !!Deno.env.get('GOOGLE_MAPS_SERVER_KEY');

    let results: any[] = [];
    let source: 'google' | 'nominatim' = 'nominatim';
    let costUsd = 0;

    if (useGoogle) {
      try {
        const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')!;
        const url =
          `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
          `?input=${encodeURIComponent(query)}` +
          `&components=country:ca` +
          `&location=${(bounds.n + bounds.s) / 2},${(bounds.e + bounds.w) / 2}` +
          // Larger radius when scope is province-wide
          `&radius=${city_slug ? 25000 : 400000}` +
          `&strictbounds=true` +
          `&key=${googleKey}`;
        const r = await fetch(url);
        const json = await r.json();
        if (json.status === 'OK' || json.status === 'ZERO_RESULTS') {
          // Google's strictbounds + 400km radius is a CIRCLE on top of
          // Alberta's rectangle — it leaks into BC + SK at the edges.
          // Movvy serves Alberta only. Post-filter every prediction to
          // require an "AB" or "Alberta" term (Google's structured
          // predictions split address parts into `terms[]`). Defense in
          // depth on top of the bookings-create server check and the
          // Nominatim viewbox.
          const inAlbertaPrediction = (p: any): boolean => {
            const terms = (p?.terms ?? []) as Array<{ value: string }>;
            for (const t of terms) {
              if (t?.value === 'AB' || t?.value === 'Alberta') return true;
            }
            const desc = (p?.description ?? '') as string;
            return /\bAB\b|\bAlberta\b/.test(desc);
          };

          results = (json.predictions ?? [])
            .filter(inAlbertaPrediction)
            .slice(0, 6)
            .map((p: any) => ({
              id: p.place_id,
              label: p.structured_formatting?.main_text ?? p.description,
              secondary: p.structured_formatting?.secondary_text ?? '',
              place_id: p.place_id,
            }));
          source = 'google';
          costUsd = COST_GOOGLE_AUTOCOMPLETE;
        } else {
          console.warn('[geocoding] google status', json.status);
          // Fall through to Nominatim
        }
      } catch (e) {
        console.error('[geocoding] google call failed, falling back', e);
      }
    }

    if (source !== 'google') {
      results = await nominatimSearch(query, bounds);
    }

    // ---- Cache + log -------------------------------------------------------
    await admin.rpc('api_cache_set', {
      p_key: cacheKey,
      p_service: source === 'google' ? 'google_places' : 'nominatim',
      p_query_hash: query.toLowerCase().slice(0, 80),
      p_response: results,
      p_ttl_seconds: source === 'google' ? 3600 : 600,  // 1h for paid, 10min for free
    });
    await admin.rpc('api_log_call', {
      p_service: source === 'google' ? 'google_places' : 'nominatim',
      p_endpoint: 'autocomplete',
      p_profile_id: user.id,
      p_ip: ip,
      p_cost_usd: costUsd,
      p_cache_hit: false,
      p_metadata: { query_length: query.length, scope },
    });

    return jsonResponse(
      { ok: true, source, results, budget: budgetRes },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[geocoding-search] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// ---- Helpers --------------------------------------------------------------

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
