// =============================================================================
// Movvy pricing engine — client mirror of supabase/functions/_shared/pricing.ts.
//
// MUST stay byte-for-byte equivalent with the server engine. Every constant
// below is duplicated server-side. The server is authoritative on every
// booking insert; this file exists only so the customer's confirm screen
// can render a breakdown without a network round-trip on every render.
//
// Customer-facing math (locked-in per founder rules):
//
// RESIDENTIAL (home_move):
//   Apartment / Condo
//     1 bed → 6 hr · 2 crew · $175/hr
//     2 bed → 8 hr · 2 crew · $175/hr
//     3 bed → 10 hr · 3 crew · $225/hr
//     4+ bed → +2 hr per extra bed, crew 3, $225/hr
//   Townhouse / House
//     2 bed → 8 hr · 2 crew · $175/hr
//     3 bed → 10 hr · 3 crew · $225/hr
//     4 bed → 12 hr · 3 crew · $225/hr
//     5+ bed → +2 hr per extra bed, crew 4, $225/hr
//
// COMMERCIAL (with or without truck — same rates):
//     2 crew → $200/hr
//     3 crew → $250/hr
//     4 crew → $400/hr  (2 trucks mandatory above 3 crew)
//     5+ crew → +$50/hr per person, still 2 trucks
//
// SMALL ITEMS / LABOR-ONLY:
//   Fallback $175/hr · customer-specified crew & hours.
//
// TRAVEL:
//   HQ (closest major city center) → pickup → drop-off, one-way.
//   Intra-city (both inside Calgary OR both inside Edmonton) → 1 hr flat.
//   Cross-city → distance ÷ 80 km/h + 0.5 hr buffer, rounded UP to 0.5 hr.
//   Travel cost = travelHours × the SAME hourly rate used for the move.
//
// FUEL (long-haul):
//   ONLY for cross-city moves with one-way distance > 100 km.
//   Customer pays $1.50/km on every km past 100. Intra-city moves: $0 fuel.
//
// MATERIALS: Flat $50 every move. No tiers, no packing add-on.
// GST: 5% on (service + travel + fuel + materials).
// TOTAL: ceil to nearest $1.
// DEPOSIT: 20% of the estimate, due at booking, credited to the final bill.
//          Refundable only if cancelled >48h before the scheduled start.
//
// DRIVER / PARTNER:
//   driver_payout = total × 0.80
//   movvy_commission = total - driver_payout (= 20%)
//   Driver UI shows ONE number — the payout. No commission breakdown.
//
// TIPS: 90% driver / 10% Movvy.
// =============================================================================

import { estimateRoute, RouteEstimate, closestMajorCity, roadKm } from './distance';

// ───── Constants (must match supabase/functions/_shared/pricing.ts) ─────────

const DRIVER_SHARE_OF_TOTAL    = 0.80;
const MATERIALS_CENTS          = 5000;     // flat $50
const TAX_RATE_GST             = 0.05;
const DEPOSIT_FRACTION         = 0.20;
const FALLBACK_RATE_CENTS_PER_HR = 17500;
const MIN_BILLABLE_HOURS       = 4;
// Past this one-way distance a move switches from all-hourly to per-km transit.
const LONG_HAUL_KM             = 100;
// Long-haul transit rate. Covers the crew's hours on the highway, the fuel, the
// wear AND the empty drive home — which is why long-haul moves carry no
// separate fuel line and no round-trip doubling.
const TRANSIT_CENTS_PER_KM     = 350;
// Hours the matrix assigns to driving across a city. On a long haul that drive
// isn't hourly any more, so it comes out of the labour estimate.
const LOCAL_DRIVE_HOURS_IN_MATRIX = 2;
const MIN_LOAD_UNLOAD_HOURS    = 3;

// Time-based fuel. Every move starts at $50 flat. If the planned total
// drive time (HQ → pickup + pickup → dropoff) exceeds 60 minutes, we add
// $25 for each additional half-hour rounded down. Replaces the old
// $/km long-haul concept — simpler for customer, simpler for driver.
const FUEL_BASE_CENTS          = 5000;
const FUEL_PER_HALF_HOUR_CENTS = 2500;
const FUEL_BASE_MINUTES        = 60;

const TIP_MOVVY_CUT            = 0.10;
const TIP_DRIVER_SHARE         = 1 - TIP_MOVVY_CUT;

// ───── Rate matrix ──────────────────────────────────────────────────────────

export type HomeDwelling = 'apartment' | 'condo' | 'townhouse' | 'house';

export interface JobProfile {
  propertyHours: number;
  recommendedCrew: number;
  hourlyRateCentsPerHr: number;
}

export function lookupResidential(dwelling: HomeDwelling, bedrooms: number): JobProfile {
  const beds = Math.max(0, bedrooms);
  const isApt = dwelling === 'apartment' || dwelling === 'condo';
  if (isApt) {
    if (beds <= 1) return { propertyHours: 6,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
    if (beds === 2) return { propertyHours: 8,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
    if (beds === 3) return { propertyHours: 10, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
    return { propertyHours: 10 + (beds - 3) * 2, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  }
  if (beds <= 2) return { propertyHours: 8,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
  if (beds === 3) return { propertyHours: 10, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  if (beds === 4) return { propertyHours: 12, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  return { propertyHours: 12 + (beds - 4) * 2, recommendedCrew: 4, hourlyRateCentsPerHr: 22500 };
}

export interface CommercialQuote {
  rateCentsPerHr: number;
  trucksIncluded: number;
}

export function lookupCommercial(crew: number): CommercialQuote {
  const c = Math.max(2, Math.min(crew, 12));
  if (c === 2) return { rateCentsPerHr: 20000, trucksIncluded: 1 };
  if (c === 3) return { rateCentsPerHr: 25000, trucksIncluded: 1 };
  return { rateCentsPerHr: 40000 + (c - 4) * 5000, trucksIncluded: 2 };
}

export function lookupCommercialRate(crew: number): number {
  return lookupCommercial(crew).rateCentsPerHr;
}

// ───── Public API ───────────────────────────────────────────────────────────

export interface PricingInput {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  moveType: 'home_move' | 'commercial' | 'single_items' | 'labor_only';

  dwelling?: HomeDwelling;
  bedrooms?: number;

  crewSize?: number;
  estimatedHours?: number;

  // Kept for input compatibility — currently no-op so the breakdown
  // matches the founder's rules (no silent add-ons inflating the total).
  packingService?: boolean;
  movingInsurance?: boolean;
  additionalHours?: number;

  propertyHoursOverride?: number;
  rateOverrideCentsPerHr?: number;

  /**
   * Real driving legs from Google Routes (routes-distance edge function).
   * Distance now sets the price directly — both travel lines AND the 100 km
   * round-trip switch — so a straight-line guess is no longer good enough.
   * Absent, we fall back to haversine × 1.30 at 80 km/h, which reads Calgary →
   * Red Deer as 178 km against a real 150.
   */
  route?: {
    hqToPickupKm: number;
    hqToPickupMinutes: number;
    pickupToDropoffKm: number;
    pickupToDropoffMinutes: number;
  };
}

export interface PriceBreakdown {
  // Hours
  travelHours: number;            // HQ → pickup, billed
  /** pickup → drop-off, billed. Doubled past LONG_HAUL_KM. */
  transportHours: number;
  /** True when transit is charged per km instead of hourly. */
  isLongHaul: boolean;
  /** Fixed transit charge on a long haul (km × rate). 0 on local moves. */
  transitCents: number;
  /** One-way pickup → drop-off distance, km. */
  transportKm: number;
  propertyHours: number;
  packingHours: number;          // always 0 now (kept for shape compat)
  additionalHours: number;       // always 0 now
  totalServiceHours: number;
  billableOnSiteHours: number;
  minimumApplied: boolean;
  recommendedCrew: number;
  trucksIncluded: number;

  hourlyRateCustomerCents: number;
  hourlyRateDriverCents: number; // legacy — displayed nowhere now, kept for shape compat

  // Customer (cents)
  serviceCostCents: number;
  travelCostCents: number;
  transportCostCents: number;
  materialsCents: number;
  insuranceCents: number;        // always 0 now
  longHaulCustomerCents: number;
  taxableSubtotalCents: number;
  gstCents: number;
  totalCents: number;
  depositCents: number;
  balanceDueOnCompletionCents: number;

  // Driver — single value only (per-line columns kept at 0)
  driverServiceCents: number;
  driverTravelCents: number;
  driverMaterialsCents: number;
  driverLongHaulCents: number;
  driverTotalCents: number;      // THE number drivers see

  // Movvy — single value only
  movvyServiceMarginCents: number;
  movvyTravelMarginCents: number;
  movvyMaterialsMarginCents: number;
  movvyInsuranceMarginCents: number;
  movvyLongHaulMarginCents: number;
  movvyTotalMarginCents: number; // THE total commission

  intraCity: boolean;
  routeKm: number;
  route: RouteEstimate;
  notes: string[];
}

export function computePricing(input: PricingInput): PriceBreakdown {
  const notes: string[] = [];

  // ── 1. Hours + rate from the matrix ────────────────────────────────────
  let propertyHours = 0;
  let recommendedCrew = 2;
  let trucksIncluded = 1;
  let hourlyRateCustomerCents = FALLBACK_RATE_CENTS_PER_HR;

  if (input.rateOverrideCentsPerHr) {
    hourlyRateCustomerCents = input.rateOverrideCentsPerHr;
  }

  if (input.moveType === 'home_move') {
    const profile = lookupResidential(input.dwelling ?? 'apartment', input.bedrooms ?? 1);
    propertyHours = input.propertyHoursOverride ?? profile.propertyHours;
    recommendedCrew = profile.recommendedCrew;
    if (!input.rateOverrideCentsPerHr) hourlyRateCustomerCents = profile.hourlyRateCentsPerHr;
  } else if (input.moveType === 'commercial') {
    const crew = input.crewSize ?? 3;
    const quote = lookupCommercial(crew);
    recommendedCrew = crew;
    trucksIncluded = quote.trucksIncluded;
    propertyHours = input.propertyHoursOverride ?? input.estimatedHours ?? 4;
    if (!input.rateOverrideCentsPerHr) hourlyRateCustomerCents = quote.rateCentsPerHr;
  } else if (input.moveType === 'labor_only') {
    recommendedCrew = input.crewSize ?? 2;
    propertyHours = input.propertyHoursOverride ?? input.estimatedHours ?? 2;
    trucksIncluded = 0;
  } else {
    recommendedCrew = 2;
    propertyHours = input.propertyHoursOverride ?? input.estimatedHours ?? 2;
  }

  // Legacy field for any UI still pulling this — kept aligned with the
  // 80% commission split so cached components don't show nonsense.
  const hourlyRateDriverCents = Math.round(hourlyRateCustomerCents * DRIVER_SHARE_OF_TOTAL);

  // ── 2. Travel — BOTH legs are billed time ──────────────────────────────
  // Two drives, each charged at the same hourly rate as the move:
  //
  //   leg 1  HQ → pickup        (getting the truck to the customer)
  //   leg 2  pickup → drop-off  (the move itself)
  //
  // Each leg rounds to the NEAREST half hour, with a half-hour floor, so a
  // ten-minute hop across a neighbourhood still bills 0.5h.
  //
  // The round-trip rule: past LONG_HAUL_KM the drop-off leg is charged BOTH
  // WAYS. Under that distance the truck is back in its service area and
  // earning again, so the return absorbs into the local rate. Past it, the
  // truck is committed to one customer for the day and has to drive home
  // empty — that return is real time the crew can't sell to anyone else.
  //
  // Leg 2 used to be excluded entirely, on the theory that the matrix hours
  // already contained it. True across a city; catastrophic at 345 km, where
  // it meant ~10 hours of driving billed as a $225 fuel line.
  const route = estimateRoute(input.pickup, input.dropoff);
  const origin = closestMajorCity(input.pickup);
  // 0.25h on each leg is the handling buffer — parking, stairs to the door,
  // the walk back. Real drive time comes from Google when the caller supplied
  // it; otherwise it's distance ÷ 80 km/h.
  const hqToPickupKm = input.route?.hqToPickupKm ?? roadKm(origin, input.pickup);
  const hqToPickupHoursRaw = input.route
    ? input.route.hqToPickupMinutes / 60 + 0.25
    : hqToPickupKm / 80 + 0.25;
  const travelHours = roundHalfMin(hqToPickupHoursRaw);

  const pickupToDropoffKm =
    input.route?.pickupToDropoffKm ?? roadKm(input.pickup, input.dropoff);
  const pickupToDropoffHoursRaw = input.route
    ? input.route.pickupToDropoffMinutes / 60 + 0.25
    : pickupToDropoffKm / 80 + 0.25;
  // ── The mode switch ────────────────────────────────────────────────────
  // Local: the drive between addresses is hourly like everything else.
  // Long-haul: it's a fixed distance charge instead, so weather and traffic
  // can't move the price and the quote is a promise rather than a meter.
  const isLongHaul = pickupToDropoffKm > LONG_HAUL_KM;
  const transportHours = isLongHaul ? 0 : roundHalfMin(pickupToDropoffHoursRaw);
  const transitCents = isLongHaul
    ? Math.round(pickupToDropoffKm * TRANSIT_CENTS_PER_KM)
    : 0;
  if (isLongHaul) {
    notes.push(
      `Long-haul: ${Math.round(pickupToDropoffKm)} km — transit billed at ` +
      `$${(TRANSIT_CENTS_PER_KM / 100).toFixed(2)}/km, which covers the drive, ` +
      `the fuel and the return. Only the loading and unloading is on the clock.`,
    );
  }

  // Only used by the LOCAL fuel line — a long haul has no separate fuel charge.
  const totalDriveMinutes = (hqToPickupHoursRaw + pickupToDropoffHoursRaw) * 60;

  // ── 3. On-site hours + 4-hour minimum ──────────────────────────────────
  // The matrix hours assume a local move — load, a drive across town, unload.
  // On a long haul that middle drive is the per-km charge, so the hourly part
  // is load + unload only.
  const labourHours = isLongHaul
    ? Math.max(MIN_LOAD_UNLOAD_HOURS, propertyHours - LOCAL_DRIVE_HOURS_IN_MATRIX)
    : propertyHours;
  const billedTravelHours = travelHours + transportHours;
  const totalRawHours = roundUpHalf(labourHours + billedTravelHours);
  const totalServiceHours = Math.max(MIN_BILLABLE_HOURS, totalRawHours);
  const minimumApplied = totalServiceHours > totalRawHours;
  const billableOnSiteHours = totalServiceHours - billedTravelHours;
  if (minimumApplied) {
    notes.push(`4-hour minimum applied (${(totalServiceHours - totalRawHours).toFixed(1)} hr added).`);
  }
  const onSiteHours = billableOnSiteHours;

  // ── 4. Customer line items ─────────────────────────────────────────────
  const serviceCostCents = Math.round(onSiteHours * hourlyRateCustomerCents);
  const travelCostCents     = Math.round(travelHours * hourlyRateCustomerCents);
  const transportCostCents  = Math.round(transportHours * hourlyRateCustomerCents);
  const materialsCents   = MATERIALS_CENTS;
  const insuranceCents   = 0;

  // Time-based fuel. $50 base covers up to 60 min total drive time
  // (HQ→pickup + pickup→dropoff). Beyond that, +$25 per half-hour, floor.
  // Long-haul fuel is already inside the per-km transit charge — billing the
  // time-based line on top would charge the same diesel twice.
  const extraMinutes = Math.max(0, totalDriveMinutes - FUEL_BASE_MINUTES);
  const extraHalfHours = Math.floor(extraMinutes / 30);
  const longHaulCustomerCents = isLongHaul
    ? 0
    : FUEL_BASE_CENTS + extraHalfHours * FUEL_PER_HALF_HOUR_CENTS;
  if (extraHalfHours > 0) {
    notes.push(`Fuel: $50 base + ${extraHalfHours} × $25 (long-haul half-hours)`);
  }

  const taxableSubtotalCents =
    serviceCostCents + travelCostCents + transportCostCents + transitCents +
    materialsCents + longHaulCustomerCents;
  const gstCents = Math.round(taxableSubtotalCents * TAX_RATE_GST);
  const totalRaw = taxableSubtotalCents + gstCents;
  const totalCents = Math.ceil(totalRaw / 100) * 100;
  const depositCents = Math.ceil((totalCents * DEPOSIT_FRACTION) / 100) * 100;
  const balanceDueOnCompletionCents = Math.max(0, totalCents - depositCents);

  // ── 5. Driver payout + Movvy commission ────────────────────────────────
  // Single rule: driver gets 80% of customer total. Movvy keeps 20%.
  // Per-line driver fields stay at 0 — UI surfaces should only read
  // driverTotalCents (the partnerJobs estimator already does).
  const driverTotalCents = Math.round(totalCents * DRIVER_SHARE_OF_TOTAL);
  const movvyTotalMarginCents = totalCents - driverTotalCents;

  notes.push('Final invoice billed on actual hours on site.');

  return {
    travelHours: round1(travelHours),
    transportHours: round1(transportHours),
    isLongHaul,
    transitCents,
    transportKm: Math.round(pickupToDropoffKm * 10) / 10,
    propertyHours: round1(propertyHours),
    packingHours: 0,
    additionalHours: 0,
    totalServiceHours,
    billableOnSiteHours: round1(billableOnSiteHours),
    minimumApplied,
    recommendedCrew,
    trucksIncluded,

    hourlyRateCustomerCents,
    hourlyRateDriverCents,

    serviceCostCents,
    travelCostCents,
    transportCostCents,
    materialsCents,
    insuranceCents,
    longHaulCustomerCents,
    taxableSubtotalCents,
    gstCents,
    totalCents,
    depositCents,
    balanceDueOnCompletionCents,

    driverServiceCents: 0,
    driverTravelCents: 0,
    driverMaterialsCents: 0,
    driverLongHaulCents: 0,
    driverTotalCents,

    movvyServiceMarginCents: 0,
    movvyTravelMarginCents: 0,
    movvyMaterialsMarginCents: 0,
    movvyInsuranceMarginCents: 0,
    movvyLongHaulMarginCents: 0,
    movvyTotalMarginCents,

    intraCity: route.intraCity,
    // routeKm now reports pickup → dropoff one-way distance (what the
    // customer sees on the map). HQ → pickup is computed but not
    // surfaced as a distance — only as the "travel time" hours line.
    routeKm: round1(pickupToDropoffKm),
    route,
    notes,
  };
}

// ───── Tip split ────────────────────────────────────────────────────────────

export interface TipSplit {
  tipCents: number;
  movvyCutCents: number;
  driverCents: number;
}

export function splitTip(tipCents: number): TipSplit {
  const cleaned = Math.max(0, Math.round(tipCents));
  const movvy = Math.round(cleaned * TIP_MOVVY_CUT);
  const driver = cleaned - movvy;
  return { tipCents: cleaned, movvyCutCents: movvy, driverCents: driver };
}

// ───── BookingDraft adapter ─────────────────────────────────────────────────

import type { BookingDraft } from '@/types';

/**
 * Quote a draft. Pass `route` (from useRouteLegs) whenever it's available —
 * without it the engine falls back to straight-line distances, and distance now
 * sets the price.
 */
export function estimatePrice(
  draft: BookingDraft,
  route?: PricingInput['route'],
): PriceBreakdown {
  const moveType = draft.moveType ?? 'home_move';
  const pickup  = { lat: draft.pickup?.lat  ?? 51.0447, lng: draft.pickup?.lng  ?? -114.0719 };
  const dropoff = { lat: draft.dropoff?.lat ?? pickup.lat, lng: draft.dropoff?.lng ?? pickup.lng };
  const d = draft.details ?? ({} as any);
  return computePricing({
    pickup, dropoff, moveType,
    dwelling: d.dwelling,
    bedrooms: d.bedrooms,
    crewSize: d.crewSize ?? d.hourlyCrewSize ?? d.helpers,
    estimatedHours: d.estimatedHours,
    // Booleans kept for input shape; ignored by computePricing.
    packingService: !!d.packingNeeded,
    movingInsurance: !!d.movingInsurance,
    route,
  });
}

// ───── Display helpers ──────────────────────────────────────────────────────

export const fmtCents       = (c: number) => `$${(c / 100).toFixed(2)}`;
export const fmtCentsShort  = (c: number) => `$${Math.round(c / 100)}`;

export const MOVE_TYPE_LABELS = {
  home_move: 'Residential',
  commercial: 'Commercial',
  single_items: 'Single items',
  labor_only: 'Labor only',
} as const;

// ───── Internal utils ───────────────────────────────────────────────────────

function roundUpHalf(n: number) { return Math.ceil(n * 2) / 2; }
/** Nearest half hour, never less than one. */
function roundHalfMin(n: number) { return Math.max(0.5, Math.round(n * 2) / 2); }
function round1(n: number)      { return Math.round(n * 10) / 10; }
