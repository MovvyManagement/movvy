// Distance helpers for fuel + travel-time estimates.
// Movvy now serves all of Alberta — every major metro has its own HQ entry
// so we can pick the closest one for bookings outside city limits
// (e.g. Banff dispatches from Calgary, Drumheller from Calgary or Red Deer,
//  Slave Lake from Edmonton or Grande Prairie).
//
// Straight-line × 1.30 fudge gives a decent road-distance estimate at $0 cost.

export type AlbertaCity =
  | 'calgary'
  | 'edmonton'
  | 'red-deer'
  | 'lethbridge'
  | 'medicine-hat'
  | 'grande-prairie'
  | 'fort-mcmurray'
  | 'airdrie'
  | 'st-albert'
  | 'okotoks';

export interface MajorCityInfo {
  slug: AlbertaCity;
  name: string;
  lat: number;
  lng: number;
  /** Loose bounding box used to decide if a coord is "inside" the city. */
  bounds: { n: number; s: number; e: number; w: number };
  /** Population — used as a tie-breaker for "closest major city" so we prefer larger HQ. */
  rank: number;
}

/** Loose province-wide bounding box covering inhabited Alberta. */
export const ALBERTA_BOUNDS = { n: 60.0, s: 49.0, e: -110.0, w: -120.0 };

export const MAJOR_CITIES: MajorCityInfo[] = [
  { slug: 'calgary',        name: 'Calgary',        lat: 51.0447, lng: -114.0719, bounds: { n: 51.2125, s: 50.8425, e: -113.8585, w: -114.2710 }, rank: 10 },
  { slug: 'edmonton',       name: 'Edmonton',       lat: 53.5461, lng: -113.4938, bounds: { n: 53.7099, s: 53.3955, e: -113.2902, w: -113.7106 }, rank: 9  },
  { slug: 'red-deer',       name: 'Red Deer',       lat: 52.2681, lng: -113.8112, bounds: { n: 52.3300, s: 52.2100, e: -113.7400, w: -113.8800 }, rank: 5  },
  { slug: 'lethbridge',     name: 'Lethbridge',     lat: 49.6956, lng: -112.8451, bounds: { n: 49.7400, s: 49.6600, e: -112.7400, w: -112.9200 }, rank: 5  },
  { slug: 'medicine-hat',   name: 'Medicine Hat',   lat: 50.0405, lng: -110.6764, bounds: { n: 50.0900, s: 50.0000, e: -110.6100, w: -110.7400 }, rank: 4  },
  { slug: 'grande-prairie', name: 'Grande Prairie', lat: 55.1707, lng: -118.7947, bounds: { n: 55.2100, s: 55.1300, e: -118.7400, w: -118.8600 }, rank: 4  },
  { slug: 'fort-mcmurray',  name: 'Fort McMurray',  lat: 56.7264, lng: -111.3803, bounds: { n: 56.7800, s: 56.6800, e: -111.3000, w: -111.4600 }, rank: 4  },
  // Commuter suburbs — kept lower-rank so they don't outrank the metro they orbit
  { slug: 'airdrie',        name: 'Airdrie',        lat: 51.2917, lng: -114.0144, bounds: { n: 51.3500, s: 51.2700, e: -113.9700, w: -114.0700 }, rank: 2  },
  { slug: 'st-albert',      name: 'St. Albert',     lat: 53.6305, lng: -113.6256, bounds: { n: 53.6700, s: 53.6000, e: -113.5800, w: -113.6900 }, rank: 2  },
  { slug: 'okotoks',        name: 'Okotoks',        lat: 50.7236, lng: -113.9750, bounds: { n: 50.7500, s: 50.6900, e: -113.9300, w: -113.9900 }, rank: 2  },
];

/** Haversine distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Crude straight-line → road conversion. */
export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * 1.30;
}

/** Which major city's bounds is this coord inside? null if "out in the wild". */
export function cityForCoord(c: { lat: number; lng: number }): AlbertaCity | null {
  for (const city of MAJOR_CITIES) {
    if (
      c.lat >= city.bounds.s && c.lat <= city.bounds.n &&
      c.lng >= city.bounds.w && c.lng <= city.bounds.e
    ) {
      return city.slug;
    }
  }
  return null;
}

/**
 * Closest major HQ for a coord. We weight by `rank` so a booking equidistant
 * to Calgary and Airdrie picks Calgary (bigger HQ, more reliable supply).
 */
export function closestMajorCity(c: { lat: number; lng: number }): MajorCityInfo {
  let best = MAJOR_CITIES[0];
  let bestScore = Infinity;
  for (const city of MAJOR_CITIES) {
    const km = haversineKm(c, city);
    // Larger rank = lower effective distance (within 30km)
    const adjusted = km - (city.rank * 0.5);
    if (adjusted < bestScore) {
      bestScore = adjusted;
      best = city;
    }
  }
  return best;
}

/** True if a coord is somewhere in the Alberta service area at all. */
export function isInAlberta(c: { lat: number; lng: number }): boolean {
  return (
    c.lat >= ALBERTA_BOUNDS.s && c.lat <= ALBERTA_BOUNDS.n &&
    c.lng >= ALBERTA_BOUNDS.w && c.lng <= ALBERTA_BOUNDS.e
  );
}

export interface RouteEstimate {
  /** Closest major city we're dispatching from. */
  origin: MajorCityInfo;
  /** Total km on the round-trip route HQ → pickup → dropoff → HQ. */
  totalKm: number;
  /** Same in hours, at ~80 km/h + 30 min handling buffer. */
  travelHours: number;
  /** True when both addresses are inside the same major city's bounds. */
  intraCity: boolean;
  intraCitySlug?: AlbertaCity;
}

const AVG_SPEED_KPH = 80;
const HANDLING_BUFFER_HRS = 0.5;

/**
 * Round-trip route used by the pricing engine:
 *   closest major city → pickup → dropoff → back to that major city
 *
 * Intra-city (both pickup + dropoff inside the SAME major city's bounds):
 *   travelHours = 1, distance not used for fuel (flat fuel rate elsewhere).
 *
 * For inter-city moves (Calgary → Edmonton, Banff → Calgary, etc.) the HQ is
 * picked from the pickup side, which is where the crew/truck starts from.
 */
export function estimateRoute(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): RouteEstimate {
  const pickupCity = cityForCoord(pickup);
  const dropoffCity = cityForCoord(dropoff);

  if (pickupCity && pickupCity === dropoffCity) {
    return {
      origin: MAJOR_CITIES.find((c) => c.slug === pickupCity)!,
      totalKm: 0,
      travelHours: 1,
      intraCity: true,
      intraCitySlug: pickupCity,
    };
  }

  const origin = closestMajorCity(pickup);
  const leg1 = roadKm(origin, pickup);
  const leg2 = roadKm(pickup, dropoff);
  const leg3 = roadKm(dropoff, origin);
  const totalKm = leg1 + leg2 + leg3;
  const travelHours = totalKm / AVG_SPEED_KPH + HANDLING_BUFFER_HRS;
  return { origin, totalKm, travelHours, intraCity: false };
}
