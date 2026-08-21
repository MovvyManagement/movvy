// =============================================================================
// Lightweight formatting helpers — shared across admin web + server.
// Mirrors src/lib/format.ts in the mobile app for consistency.
// =============================================================================

/** Format a dollar amount with CAD currency. */
export function fmtCurrency(dollars: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: dollars >= 100 ? 0 : 2,
  }).format(dollars);
}

/** Format a cents integer as CAD currency. */
export function fmtCents(cents: number | null | undefined): string {
  return fmtCurrency((cents ?? 0) / 100);
}

/**
 * Short date: "Jun 29, 2026"
 *
 * Accepts a timestamp OR a bare `YYYY-MM-DD` date column. The distinction
 * matters: `new Date('2026-08-17')` is parsed as UTC midnight, which is 6:00 PM
 * on the 16th in Alberta, so a date-only value rendered through the naive path
 * comes out a day early — a payout period ending "Aug 16" when the column says
 * the 17th. A calendar date has no time zone; build it as a local date so it
 * survives the trip.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(iso);
  const d = dateOnly
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
    : new Date(iso);
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Short datetime: "Jun 29, 2:35 PM" */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Relative time: "just now", "5m ago", "3h ago", "2d ago" */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

/** Convert snake_case status to Title Case: "on_the_way" → "On The Way" */
export function fmtStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Format a number with locale-aware thousands separators: 12345 → "12,345" */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-CA').format(n);
}

/** Format a duration in minutes: 90 → "1h 30m" */
export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format a distance in km: 12.5 → "12.5 km" */
export function fmtDistance(km: number | null | undefined): string {
  if (km == null) return '—';
  return `${km.toFixed(1)} km`;
}

/** Format a percentage 0–1: 0.1234 → "12.3%" */
export function fmtPct(ratio: number | null | undefined, decimals = 1): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/** ISO date string for today in UTC: "2026-06-29" */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Start of today as ISO string in UTC. */
export function startOfTodayISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Start of this month as ISO string in UTC. */
export function startOfMonthISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  return d.toISOString();
}
