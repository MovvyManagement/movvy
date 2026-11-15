// Client-side geocoding.
//
// SECURITY: The client NEVER calls Google directly. All paid-API calls go
// through our `geocoding-search` edge function which enforces rate limits,
// caches results, checks daily budget, and falls back to free Nominatim if
// any of those guards trip. The Google API key never ships in the app bundle.
//
// During development, the edge function defaults to Nominatim (free) until
// you explicitly enable Google by:
//   1. Adding GOOGLE_MAPS_SERVER_KEY to Supabase Functions secrets
//   2. Setting feature_flags.google_places_enabled = true in the DB
//   3. Confirming your daily budget cap in api_budgets

import { FunctionRegion, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, supabaseFunctionsUrl } from './supabase';
import { ALBERTA_BOUNDS, cityForCoord, closestMajorCity, MAJOR_CITIES } from './distance';

/** Kept for backwards-compat — Calgary is one of many Alberta cities now. */
export const CALGARY = {
  center: { lat: 51.0447, lng: -114.0719 },
  bounds: { north: 51.2125, south: 50.8425, east: -113.8585, west: -114.2710 },
};

export interface GeocodeResult {
  id: string;
  label: string;
  secondary: string;
  lat: number;
  lng: number;
  place_id?: string;   // Google place_id when source=google
  raw?: any;
}

// -----------------------------------------------------------------------------
// City / province extraction
//
// A geocode result has to become the {city, province} we persist on a booking.
// We previously hardcoded "Calgary, AB" for EVERY booking, which silently
// mis-routed Edmonton / Red Deer / Lethbridge moves — the matcher keys off the
// booking's city, so an Edmonton move tagged "Calgary" never reached an
// Edmonton crew. Derive it for real instead:
//   1. Prefer the settlement name Nominatim already parsed (city/town/village).
//   2. Fall back to the nearest major Alberta city by coordinate (the same
//      logic dispatch uses) when the payload carries no settlement name.
// Province normalizes to a 2-letter code, defaulting to AB (our only market).
// -----------------------------------------------------------------------------

const PROVINCE_CODES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  saskatchewan: 'SK',
  manitoba: 'MB',
  ontario: 'ON',
  quebec: 'QC',
  québec: 'QC',
  'new brunswick': 'NB',
  'nova scotia': 'NS',
  'prince edward island': 'PE',
  'newfoundland and labrador': 'NL',
};

function normalizeProvince(raw?: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'AB';
  const key = raw.trim().toLowerCase();
  if (PROVINCE_CODES[key]) return PROVINCE_CODES[key];
  // Already a 2-letter code? Uppercase it. Otherwise default to our market.
  return key.length === 2 ? key.toUpperCase() : 'AB';
}

/**
 * Resolve the {city, province} to store on a booking from a geocode result.
 * Robust to both data sources: Nominatim (carries raw.address + coords) and a
 * coords-only result (falls back to nearest major city). Never throws; defaults
 * to Calgary / AB when nothing else is resolvable.
 */
export function cityProvinceFromGeocode(
  geo: { lat?: number; lng?: number; raw?: any },
): { city: string; province: string } {
  const a = geo.raw?.address ?? {};
  const province = normalizeProvince(a.state ?? a.province ?? a.region);

  // Nominatim populates exactly one of these depending on settlement size.
  const named = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb;
  if (typeof named === 'string' && named.trim()) {
    return { city: named.trim(), province };
  }

  // No settlement in the payload — resolve by coordinate. cityForCoord is an
  // exact bounding-box hit; closestMajorCity is the "out in the wild" fallback
  // (and itself defaults to Calgary when coords are missing / NaN).
  const coord = { lat: Number(geo.lat), lng: Number(geo.lng) };
  const slug =
    Number.isFinite(coord.lat) && Number.isFinite(coord.lng) ? cityForCoord(coord) : null;
  const info = slug ? MAJOR_CITIES.find((c) => c.slug === slug)! : closestMajorCity(coord);
  return { city: info.name, province };
}

// -----------------------------------------------------------------------------
// Speed
//
// Suggestions are asked for at every pause in typing, so three things keep
// them quick:
//   1. The address functions are pinned to the region the database is in. Each
//      search makes several database calls, and running next to it beats
//      running in whichever region happens to be nearest the phone.
//   2. Answers are remembered for a few minutes, so backspacing or retyping an
//      address shows its suggestions instantly, with no request at all.
//   3. Two callers asking for the same text at the same moment share one
//      request.
// -----------------------------------------------------------------------------
const SEARCH_REGION = FunctionRegion.CaCentral1;
const SEARCH_MEMORY_MS = 10 * 60 * 1000;
const SEARCH_MEMORY_MAX = 80;
const PLACE_MEMORY_MAX = 50;
const WARM_UP_EVERY_MS = 60 * 1000;

const rememberedSearches = new Map<string, { at: number; results: GeocodeResult[] }>();
const searchesInFlight = new Map<string, Promise<GeocodeResult[]>>();
const rememberedPlaces = new Map<string, GeocodeResult>();
let warmedAt = 0;

const searchKey = (query: string) => query.trim().toLowerCase().replace(/\s+/g, ' ');

/** Suggestions already fetched for exactly this text, if they are still fresh. */
export function rememberedSearch(query: string): GeocodeResult[] | null {
  const key = searchKey(query);
  const hit = rememberedSearches.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_MEMORY_MS) {
    rememberedSearches.delete(key);
    return null;
  }
  return hit.results;
}

function rememberSearch(query: string, results: GeocodeResult[]): void {
  const key = searchKey(query);
  rememberedSearches.delete(key);
  if (rememberedSearches.size >= SEARCH_MEMORY_MAX) {
    rememberedSearches.delete(rememberedSearches.keys().next().value as string);
  }
  rememberedSearches.set(key, { at: Date.now(), results });
}

/**
 * Call an address function in the database's region. If that region can't be
 * reached at all, try once more wherever Supabase chooses. An answer from the
 * function itself (rate limit, bad input) is returned as is, never retried.
 */
async function invokeNearDatabase(name: string, body: Record<string, unknown>) {
  const pinned = await supabase.functions.invoke(name, { body, region: SEARCH_REGION });
  if (!pinned.error || pinned.error instanceof FunctionsHttpError) return pinned;
  return supabase.functions.invoke(name, { body });
}

/**
 * Wake the address functions, and open the connection to them, before the
 * first keystroke needs either. Call when an address field is opened. The
 * request does no work on the server and counts against no limit.
 */
export function warmAddressSearch(): void {
  if (!supabaseFunctionsUrl) return;
  const now = Date.now();
  if (now - warmedAt < WARM_UP_EVERY_MS) return;
  warmedAt = now;
  for (const name of ['geocoding-search', 'place-details']) {
    fetch(`${supabaseFunctionsUrl}/${name}?forceFunctionRegion=${SEARCH_REGION}`, {
      method: 'OPTIONS',
    }).catch(() => {
      // Only a head start. The real search reports any real problem.
    });
  }
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Of the suggestions already on screen, the ones that still fit what has been
 * typed since. Lets the list keep up with the keyboard while the next answer
 * is on its way. If none of them fit, the list is left alone rather than
 * emptied, because the server matches more loosely than this does.
 */
export function narrowSuggestions(current: GeocodeResult[], query: string): GeocodeResult[] {
  const typed = wordsOf(query);
  if (typed.length === 0 || current.length === 0) return current;
  const fitting = current.filter((s) => {
    const shown = wordsOf(`${s.label} ${s.secondary ?? ''}`);
    return typed.every((t) => shown.some((w) => w.startsWith(t)));
  });
  return fitting.length > 0 && fitting.length < current.length ? fitting : current;
}

/**
 * Search Alberta-wide addresses through the protected edge function.
 *
 * Falls back to direct Nominatim *only* if Supabase isn't configured yet
 * (i.e. dev demo mode without backend). When the backend is live, the edge
 * function decides between Google (paid, gated) and Nominatim (free) based on
 * feature flags + remaining daily budget.
 *
 * Pass `signal` to be told when an answer is no longer wanted: the call then
 * rejects with an AbortError instead of returning a stale answer. The request
 * itself is left to finish, so its answer is still remembered for next time.
 */
export async function searchAlberta(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const remembered = rememberedSearch(q);
  if (remembered) return remembered;

  const key = searchKey(q);
  let search = searchesInFlight.get(key);
  if (!search) {
    search = runSearch(q).finally(() => searchesInFlight.delete(key));
    searchesInFlight.set(key, search);
  }
  const results = await search;
  if (signal?.aborted) {
    const stale = new Error('Search no longer needed');
    stale.name = 'AbortError';
    throw stale;
  }
  return results;
}

async function runSearch(q: string): Promise<GeocodeResult[]> {
  // No Supabase? Skip straight to Nominatim — dev / demo case.
  if (!supabaseConfigured) {
    return nominatimDirect(q);
  }

  // Try the edge function first (gives us Google when enabled + caching +
  // budget enforcement). If it errors out (not deployed, rate-limited,
  // auth missing, etc.), fall back to direct Nominatim so the user STILL
  // gets address suggestions instead of a dead input.
  try {
    const { data, error } = await invokeNearDatabase('geocoding-search', {
      query: q,
      province: 'AB',
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    let results = (data?.results ?? []) as GeocodeResult[];
    if (results.length === 0) {
      // Edge function returned an empty result — try Nominatim as a second
      // pass before giving up. Common when Google budget is exhausted.
      results = await nominatimDirect(q);
    }
    rememberSearch(q, results);
    return results;
  } catch (e) {
    if (__DEV__) {
      console.warn('[geocoding] edge function failed, falling back to Nominatim:', e);
    }
    // Not remembered: the next attempt should try the fast path again.
    return nominatimDirect(q);
  }
}

/** Legacy alias for backwards-compat. New code should use searchAlberta. */
export const searchCalgary = searchAlberta;

/**
 * Resolve a Google Places `place_id` into a full GeocodeResult with coordinates.
 *
 * Google's autocomplete predictions carry NO lat/lng — only a place_id. Our
 * whole booking flow needs coordinates (pricing distance, map pins, city
 * routing), so when the user PICKS a Google suggestion we resolve it here via
 * the protected `place-details` edge function (one paid Place Details call per
 * accepted pick, budget-guarded + cached server-side).
 *
 * Returns null if resolution fails (no backend, budget blown, key missing,
 * out-of-area) — callers should keep the prediction's display text but treat
 * it as un-geocoded (i.e. not bookable) rather than proceeding with no coords.
 */
export async function resolvePlaceId(
  placeId: string,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  if (!placeId || !supabaseConfigured) return null;
  // A place's coordinates never change, so a pick made earlier is instant.
  const remembered = rememberedPlaces.get(placeId);
  if (remembered) return remembered;
  try {
    const { data, error } = await invokeNearDatabase('place-details', { place_id: placeId });
    if (signal?.aborted) return null;
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const r = data?.result as GeocodeResult | undefined;
    if (!r || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng))) return null;
    if (rememberedPlaces.size >= PLACE_MEMORY_MAX) {
      rememberedPlaces.delete(rememberedPlaces.keys().next().value as string);
    }
    rememberedPlaces.set(placeId, r);
    return r;
  } catch (e) {
    if (__DEV__) console.warn('[geocoding] place-details resolve failed:', e);
    return null;
  }
}

/** True when a result still needs coordinate resolution (Google prediction). */
export function needsResolution(r: GeocodeResult): boolean {
  return !!r.place_id && (!Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lng)));
}

export interface LatLng { latitude: number; longitude: number; }

/**
 * Fetch a ROAD-FOLLOWING route between two points for the map. Returns the
 * decoded polyline coordinates (street-tracing), or `null` when road routing
 * isn't available (backend off, budget blown, Routes API not enabled) — the
 * caller then falls back to a straight line so the map still renders.
 */
export async function fetchRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<LatLng[] | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.functions.invoke('directions', {
      body: { origin, destination },
    });
    if (signal?.aborted) return null;
    if (error) throw error;
    if (data?.error || !data?.polyline) return null;
    const coords = decodePolyline(data.polyline as string);
    return coords.length >= 2 ? coords : null;
  } catch (e) {
    if (__DEV__) console.warn('[geocoding] directions fetch failed, straight line:', e);
    return null;
  }
}

/**
 * Decode a Google "encoded polyline" string into {latitude, longitude} points.
 * Standard algorithm (precision 5) — no external dependency so it works inside
 * the Expo/Hermes runtime with zero extra bundle weight.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;
  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

/** Direct Nominatim — kept as the demo-mode fallback only. Alberta-wide. */
async function nominatimDirect(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: '6',
    viewbox: `${ALBERTA_BOUNDS.w},${ALBERTA_BOUNDS.n},${ALBERTA_BOUNDS.e},${ALBERTA_BOUNDS.s}`,
    bounded: '1',
    countrycodes: 'ca',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Movvy-Dev/0.1 (https://movvy.ca)',
    },
  });
  if (!res.ok) return [];
  const json: any[] = await res.json();
  if (!Array.isArray(json)) return [];
  return json
    .filter((r) => {
      if (!r?.lat || !r?.lon) return false;
      // Trust the bounded=1 viewbox filter Nominatim already applied — be
      // lenient on the state name because Nominatim sometimes returns
      // 'Alberta', 'AB', or no state at all for partial matches. Keep any
      // Canadian result inside our bbox.
      const a = r.address ?? {};
      const country = (a.country_code ?? '').toLowerCase();
      const state = (a.state ?? '').toLowerCase();
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const inBox =
        lat >= ALBERTA_BOUNDS.s && lat <= ALBERTA_BOUNDS.n &&
        lng >= ALBERTA_BOUNDS.w && lng <= ALBERTA_BOUNDS.e;
      if (!inBox) return false;
      if (country && country !== 'ca') return false;
      if (state && !state.includes('alberta') && state !== 'ab') return false;
      return true;
    })
    .map((r, i) => {
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
        raw: r,
      };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}
