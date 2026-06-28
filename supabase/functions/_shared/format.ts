// =============================================================================
// Shared formatters — used by every edge function that builds an email
// payload. Centralized so a single Locale / currency / date-format change
// doesn't require sweeping 10 files.
//
// Mountain Time on purpose — every Movvy customer + partner is in Alberta.
// =============================================================================

const MOUNTAIN_TZ = 'America/Edmonton';

// ─── Money ───────────────────────────────────────────────────────────────────

/**
 * Format a cents-integer as a CAD dollar string with thousands separators.
 *
 *   fmtMoney(142000)  → "$1,420"
 *   fmtMoney(161250)  → "$1,612.50"  (kept 2dp because the cents aren't 0)
 *   fmtMoney(0)       → "$0"
 *   fmtMoney(null)    → "$0"
 */
export function fmtMoney(cents: number | null | undefined): string {
  const c = cents ?? 0;
  const dollars = c / 100;
  const hasFraction = c % 100 !== 0;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(dollars);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * "Sat, Jul 11" — used for the headline of every booking-related email.
 * dateStr is the bookings.scheduled_for_date "YYYY-MM-DD" value.
 */
export function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr + 'T12:00:00Z'); // noon-UTC anchor avoids tz drift
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * "Sat, Jul 11 · 8:00 AM" — for the booking-confirmed email. Combines the
 * date with the start hour of the scheduled window.
 */
export function fmtDateTime(
  dateStr: string | null | undefined,
  startHour24: number | null | undefined,
): string {
  if (!dateStr) return 'TBD';
  const datePart = fmtDateShort(dateStr);
  if (startHour24 == null) return datePart;
  const h = ((startHour24 + 11) % 12) + 1;
  const ampm = startHour24 >= 12 ? 'PM' : 'AM';
  return `${datePart} · ${h}:00 ${ampm}`;
}

/**
 * Parse the "8AM-12PM" / "8:00 AM - 12:00 PM" / "morning" window string
 * into a clean display form. Falls back to the original string when it
 * can't parse — better than guessing.
 *
 *   fmtTimeWindow("8AM-12PM")      → "8:00 AM – 12:00 PM"
 *   fmtTimeWindow("morning")        → "morning"
 */
export function fmtTimeWindow(window: string | null | undefined): string {
  if (!window) return '';
  // Already pretty?
  if (/^\d{1,2}:\d{2}\s*[AP]M\s*[–-]/i.test(window)) return window.replace(/-/g, '–');
  const m = window.match(/^(\d{1,2})\s*(AM|PM)?\s*[-–]\s*(\d{1,2})\s*(AM|PM)?$/i);
  if (!m) return window;
  const [, h1, ap1, h2, ap2] = m;
  const fmt = (h: string, ap: string | undefined) =>
    `${parseInt(h, 10)}:00 ${ap?.toUpperCase() ?? 'AM'}`;
  // Auto-derive AM/PM if only one specified
  const ampm1 = ap1 ?? (parseInt(h1, 10) >= 8 && parseInt(h2, 10) < 8 ? 'AM' : 'AM');
  const ampm2 = ap2 ?? (parseInt(h2, 10) >= 1 && parseInt(h2, 10) < 8 ? 'PM' : ampm1);
  return `${fmt(h1, ampm1)} – ${fmt(h2, ampm2)}`;
}

/**
 * Extract the start hour (24h) from a window string. Returns null if
 * unparseable. Used by fmtDateTime above.
 */
export function startHourFromWindow(
  window: string | null | undefined,
): number | null {
  if (!window) return null;
  const m = window.match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = m[2]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h;
}

/**
 * "+30 days" from today as a human-readable Mountain Time date.
 * Used for accountDeleted's hardDeleteOn field.
 */
export function fmtDatePlusDays(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TZ,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

// ─── Hours ───────────────────────────────────────────────────────────────────

/**
 * "3.5 hrs" — trims trailing .0 so a 4-hour move shows as "4 hrs" not "4.0 hrs".
 */
export function fmtHours(hours: number | null | undefined): string {
  if (hours == null) return '0 hrs';
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} hrs`;
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/**
 * Combine line1 + city into a single display address.
 *
 *   fmtAddress("123 17 Ave SW", "Calgary")  → "123 17 Ave SW, Calgary"
 *   fmtAddress(null, "Edmonton")             → "Edmonton"
 *   fmtAddress("123 17 Ave SW", null)        → "123 17 Ave SW"
 */
export function fmtAddress(
  line1: string | null | undefined,
  city: string | null | undefined,
): string {
  const parts = [line1, city].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Address on file';
}

// ─── Money: driver payout breakdown ──────────────────────────────────────────

/**
 * Returns the Movvy commission cents for a given driver payout total
 * assuming our 20% take. Used by weeklyPayoutSummary so we don't have
 * to read the row + add a column for it.
 */
export function commissionCentsFromDriverPayout(
  driverPayoutCents: number,
): number {
  // driverPayoutCents = grossCents * 0.80
  //   ⇒ grossCents = driverPayoutCents / 0.80
  //   ⇒ commissionCents = grossCents * 0.20
  const gross = driverPayoutCents / 0.8;
  return Math.round(gross * 0.2);
}
