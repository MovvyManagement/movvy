// =============================================================================
// Shared helpers for the public booking and live tracking pages.
//
// Prices are never computed here. The website asks web-quote, and
// bookings-create recomputes on the server, so the two can't disagree.
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const ARRIVAL_WINDOW = '9:00 AM – 11:00 AM';
export const TERMS_VERSION = '2026-06-02';
export const MIN_PASSWORD_LENGTH = 10;
const MIN_LEAD_DAYS = 3;
const CALENDAR_DAYS = 21;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Call a Supabase edge function, as a visitor or as a signed-in customer. */
export async function callFunction<T>(
  name: string,
  body: unknown,
  accessToken?: string,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLIC_KEY,
        Authorization: `Bearer ${accessToken ?? PUBLIC_KEY}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Check your connection and try again.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const message =
      res.status === 429
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : json.error ?? 'Something went wrong. Please try again.';
    throw new ApiError(message, res.status);
  }
  return json as T;
}

export const money = (cents: number | null | undefined, decimals = false) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format((cents ?? 0) / 100);

// ── Addresses ────────────────────────────────────────────────────────────────

export interface Address {
  line1: string;
  city: string;
  province: string;
  postal: string;
  lat: number;
  lng: number;
}

export interface AddressMatch {
  id: string;
  label: string;
  secondary?: string;
  place_id?: string;
  lat?: number;
  lng?: number;
}

export async function searchAddresses(query: string, signal?: AbortSignal) {
  const res = await callFunction<{ results: AddressMatch[] }>(
    'geocoding-search',
    { query, province: 'AB' },
    undefined,
    signal,
  );
  return res.results ?? [];
}

const POSTAL_RE = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i;

/** The free fallback search has no structured address, only "Area · City · T2P 1J9". */
function cityFromSecondary(secondary?: string) {
  const parts = (secondary ?? '')
    .split(/·|,/)
    .map((s) => s.trim())
    .filter((s) => s && !POSTAL_RE.test(s) && !/^(AB|Alberta|Canada)$/i.test(s));
  return parts[parts.length - 1] ?? 'Calgary';
}

export async function resolveAddress(match: AddressMatch): Promise<Address> {
  if (match.place_id) {
    const { result } = await callFunction<{
      result: {
        label: string;
        lat: number;
        lng: number;
        raw?: { address?: { city?: string; town?: string; state?: string; postcode?: string } };
      };
    }>('place-details', { place_id: match.place_id });
    const a = result.raw?.address ?? {};
    return {
      line1: result.label,
      city: a.city ?? a.town ?? cityFromSecondary(match.secondary),
      province: a.state ?? 'AB',
      postal: a.postcode ?? '',
      lat: result.lat,
      lng: result.lng,
    };
  }
  const postal = (match.secondary ?? '').split(/·|,/).map((s) => s.trim()).find((s) => POSTAL_RE.test(s));
  return {
    line1: match.label,
    city: cityFromSecondary(match.secondary),
    province: 'AB',
    postal: postal ?? '',
    lat: match.lat as number,
    lng: match.lng as number,
  };
}

export const addressPayload = (a: Address) => ({
  line1: a.line1,
  city: a.city,
  region: a.province,
  country_code: 'CA',
  postal: a.postal || undefined,
  lat: a.lat,
  lng: a.lng,
});

// ── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarDay {
  iso: string;
  weekday: string;
  day: number;
  month: string;
  disabled: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The same window the app offers. Built from local dates so it can't slip a day. */
export function buildCalendar(): CalendarDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return {
      iso: localIso(d),
      weekday: d.toLocaleDateString('en-CA', { weekday: 'short' }),
      day: d.getDate(),
      month: d.toLocaleDateString('en-CA', { month: 'short' }),
      disabled: i < MIN_LEAD_DAYS,
    };
  });
}

export function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ── Phone ────────────────────────────────────────────────────────────────────

export const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
};
export const toE164 = (value: string) => `+1${phoneDigits(value)}`;
export const isPhoneComplete = (value: string) => phoneDigits(value).length === 10;

export function formatPhone(value: string) {
  const d = phoneDigits(value);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// ── Quotes ───────────────────────────────────────────────────────────────────

export interface Quote {
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
  subtotal_cents: number;
  hourly_rate_cents: number;
  crew: number;
  trucks: number;
  on_site_hours: number;
  total_hours: number;
  minimum_applied: boolean;
  service_cents: number;
  travel_cents: number;
  transit_cents: number;
  fuel_cents: number;
  materials_cents: number;
  gst_cents: number;
  is_long_haul: boolean;
}

// ── Live tracking ────────────────────────────────────────────────────────────

export type MoveStatus =
  | 'draft' | 'pending' | 'searching' | 'assigned' | 'confirmed' | 'on_the_way'
  | 'arrived' | 'loading' | 'in_transit' | 'unloading' | 'completed' | 'cancelled' | 'failed';

export interface Place {
  line1: string;
  city: string;
  lat: number | null;
  lng: number | null;
}

export interface Snapshot {
  booking_id: string;
  short_code: string;
  status: MoveStatus;
  date: string;
  window: string;
  pickup: Place;
  dropoff: Place | null;
  notes: string;
  crew: {
    name: string | null;
    rating_avg: number | null;
    rating_count: number;
    verified: boolean;
    driver_first_name: string | null;
    driver_avatar_url: string | null;
    truck: string | null;
  } | null;
  ping: { lat: number; lng: number; recorded_at: string } | null;
  timeline: { status: MoveStatus; at: string }[];
  billing: {
    started_at: string | null;
    completed_at: string | null;
    hourly_rate_cents: number | null;
    is_long_haul: boolean;
    transit_cents: number;
    in_transit_at: string | null;
    unloading_at: string | null;
  };
  money: {
    estimate_cents: number;
    final_cents: number | null;
    actual_hours: number | null;
    deposit_cents: number;
    deposit_applied_cents: number;
    credit_applied_cents: number;
    paid: boolean;
    due_cents: number;
  };
  rated: boolean;
  can: { modify: boolean; cancel: boolean; deposit_refundable: boolean };
}

export const TRACK_SESSION_KEY = 'movvy-track-session';

export interface TrackSession {
  code: string;
  token: string;
}

/** Tab-only on purpose: once the tab closes, the code and digits are needed again. */
export function saveTrackSession(session: TrackSession) {
  try {
    sessionStorage.setItem(TRACK_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private windows can refuse storage. The page still works until a refresh.
  }
}

export function loadTrackSession(): TrackSession | null {
  try {
    const raw = sessionStorage.getItem(TRACK_SESSION_KEY);
    return raw ? (JSON.parse(raw) as TrackSession) : null;
  } catch {
    return null;
  }
}

export function clearTrackSession() {
  try {
    sessionStorage.removeItem(TRACK_SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

export async function openTracking(code: string, last4: string) {
  const res = await callFunction<{ token: string; snapshot: Snapshot }>('web-track', {
    action: 'open',
    code,
    last4,
  });
  saveTrackSession({ code: res.snapshot.short_code, token: res.token });
  return res;
}
