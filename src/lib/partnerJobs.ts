// =============================================================================
// Partner-facing job presentation — the single place that turns a raw booking
// into the numbers + signals a driver/dispatcher sees BEFORE accepting a move.
//
// Why this module exists: the "you'll earn $X" figure and the effort/distance
// signals on a job card used to be computed inline on every screen (the driver
// dashboard, the open-pool Jobs tab, the job-detail screen). That let the same
// job show one payout on the dashboard and a different one in Earnings. Funnel
// every surface through these helpers so the numbers can never drift.
//
// IMPORTANT — estimate vs. truth:
//   • estimatePartnerPayoutCents() is a PRE-acceptance ESTIMATE for job cards.
//   • The authoritative POST-move payout is driver_payouts.net_cents, surfaced
//     by useEarnings / the Earnings screen. Never reconcile money against the
//     estimate — it's a sales figure, not an accounting one.
// =============================================================================

import type { DbBooking } from '@/lib/supabase/types';
import { PARTNER_SHARE_RATE } from '@/lib/brand';
import { haversineKm } from '@/lib/distance';

/** Fields any job-feed row carries that we need to estimate a payout. */
type PayoutInput = Pick<DbBooking, 'price_total_cents' | 'price_commission_cents'>;

/**
 * Estimated partner payout for a job, in CENTS.
 *
 * Preference order:
 *   1. price_total_cents − price_commission_cents — the server already computed
 *      the exact commission for this specific booking, so when it's present and
 *      sane we use it. This is the most accurate pre-payout figure.
 *   2. price_total_cents × PARTNER_SHARE_RATE — flat-rate fallback for rows
 *      where the per-booking commission wasn't stored (older rows / fixtures).
 */
export function estimatePartnerPayoutCents(b: PayoutInput): number {
  const total = b.price_total_cents ?? 0;
  const commission = b.price_commission_cents ?? 0;
  // A valid commission is a positive slice strictly smaller than the total.
  // Anything else (0, negative, or >= total) is treated as "not recorded".
  if (commission > 0 && commission < total) {
    return total - commission;
  }
  return Math.round(total * PARTNER_SHARE_RATE);
}

/** Convenience wrapper for callers that want dollars, not cents. */
export function estimatePartnerPayoutDollars(b: PayoutInput): number {
  return estimatePartnerPayoutCents(b) / 100;
}

// -----------------------------------------------------------------------------
// Effort signals — the "how hard is this move?" heads-up a driver weighs when
// deciding whether to accept. Extracted from the booking's free-form `details`
// blob, whose shape varies by move_type (see app/(customer)/book/*).
// -----------------------------------------------------------------------------

export interface JobEffort {
  /**
   * Flights of stairs the crew must physically climb.
   *   • home_move  → floor − 1 when there's no elevator (2nd floor = 1 flight),
   *                  0 when an elevator is available.
   *   • single_items → stairsPickup + stairsDropoff (already counted in flights).
   *   • everything else → 0 (not captured).
   */
  stairs: number;
  hasElevator: boolean;
  heavyItems: boolean;
  fragileItems: boolean;
  packingNeeded: boolean;
  assemblyNeeded: boolean;
  /** Bedrooms for a home move (0 otherwise) — a rough size proxy. */
  bedrooms: number;
  /**
   * Short labels ready to drop straight into <Badge> chips on a job card,
   * ordered by what matters most to the accept decision (physical effort
   * first). Empty when the move has no notable effort signals.
   */
  chips: string[];
}

const asNum = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) || 0 : 0;
const asBool = (v: unknown): boolean => v === true;

export function jobEffort(b: Pick<DbBooking, 'move_type' | 'details'>): JobEffort {
  const d = b.details ?? {};

  const hasElevator = asBool(d.hasElevator);
  const heavyItems = asBool(d.heavyItems);
  const fragileItems = asBool(d.fragileItems);
  const packingNeeded = asBool(d.packingNeeded);
  const assemblyNeeded = asBool(d.assemblyNeeded);
  const bedrooms = asNum(d.bedrooms);

  let stairs = 0;
  if (b.move_type === 'home_move') {
    // floor is 1-indexed (floor 1 = ground), so flights climbed = floor − 1.
    const floor = asNum(d.floor);
    stairs = hasElevator ? 0 : Math.max(0, floor - 1);
  } else {
    stairs = asNum(d.stairsPickup) + asNum(d.stairsDropoff);
  }

  const chips: string[] = [];
  if (stairs > 0) chips.push(`${stairs} ${stairs === 1 ? 'flight' : 'flights'} of stairs`);
  if (heavyItems) chips.push('Heavy items');
  if (fragileItems) chips.push('Fragile');
  if (packingNeeded) chips.push('Packing');
  if (assemblyNeeded) chips.push('Assembly');

  return {
    stairs,
    hasElevator,
    heavyItems,
    fragileItems,
    packingNeeded,
    assemblyNeeded,
    bedrooms,
    chips,
  };
}

// -----------------------------------------------------------------------------
// Distance-to-pickup — "how far do I have to drive just to START this job?" The
// open-pool feed is already radius-filtered server-side, but the exact km from
// where the driver is standing is the single biggest accept-or-skip factor.
// -----------------------------------------------------------------------------

/**
 * Straight-line km from a driver's current location to a booking's pickup.
 * Returns null when we don't have the driver's location yet or the booking is
 * missing pickup coords — callers should simply omit the chip in that case.
 */
export function distanceToPickupKm(
  from: { lat: number; lng: number } | null | undefined,
  b: Pick<DbBooking, 'pickup_lat' | 'pickup_lng'>,
): number | null {
  if (!from || b.pickup_lat == null || b.pickup_lng == null) return null;
  return haversineKm(from, { lat: b.pickup_lat, lng: b.pickup_lng });
}

// -----------------------------------------------------------------------------
// Scheduling urgency — "which unassigned job is on fire?" Shared by the
// dispatcher's Jobs tab AND the dashboard's incoming list so the at-a-glance
// home and the working surface can never disagree about what's urgent.
// -----------------------------------------------------------------------------

export type JobUrgencyTone = 'critical' | 'warn' | null;

export interface JobUrgency {
  /** Display label, e.g. "Starts in 45m", "Started 12m ago", or '' when calm. */
  label: string;
  /** critical = red (≤6h or already started), warn = amber (≤24h), null = calm. */
  tone: JobUrgencyTone;
  /** Signed minutes until the window start (negative = already started). */
  minutesUntil: number | null;
}

/**
 * Time-to-start urgency for a scheduled job.
 *   • critical (red)  — already started without a driver, or starts within 6h.
 *   • warn (amber)    — starts within 24h.
 *   • null            — further out, or no scheduled start time.
 */
export function jobUrgency(startsAtIso: string | null | undefined): JobUrgency {
  const startsAt = startsAtIso ? new Date(startsAtIso).getTime() : null;
  const minutesUntil = startsAt ? Math.round((startsAt - Date.now()) / 60_000) : null;
  if (minutesUntil == null) return { label: '', tone: null, minutesUntil: null };
  if (minutesUntil < 0)
    return { label: `Started ${Math.abs(minutesUntil)}m ago`, tone: 'critical', minutesUntil };
  if (minutesUntil < 60) return { label: `Starts in ${minutesUntil}m`, tone: 'critical', minutesUntil };
  if (minutesUntil < 60 * 6)
    return {
      label: `Starts in ${Math.floor(minutesUntil / 60)}h ${minutesUntil % 60}m`,
      tone: 'critical',
      minutesUntil,
    };
  if (minutesUntil < 60 * 24)
    return { label: `Starts in ${Math.floor(minutesUntil / 60)}h`, tone: 'warn', minutesUntil };
  return { label: '', tone: null, minutesUntil };
}
