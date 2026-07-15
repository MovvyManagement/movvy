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
}

export interface PriceBreakdown {
  // Hours
  travelHours: number;
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

  // ── 2. Travel (HQ → PICKUP only — for the estimate breakdown) ──────────
  // The customer's "Travel time" line is the drive from HQ to their
  // pickup. The pickup → dropoff drive is bundled into the matrix
  // property hours (the matrix represents typical load + drive + unload).
  //
  // On move day, the actual timer starts the moment the driver presses
  // "We've left HQ" and runs to "Finish Move" — so it captures HQ →
  // pickup + load + pickup → dropoff + unload as one block.
  const route = estimateRoute(input.pickup, input.dropoff);
  const origin = closestMajorCity(input.pickup);
  const hqToPickupKm = roadKm(origin, input.pickup);
  const hqToPickupHoursRaw = hqToPickupKm / 80 + 0.25;
  const travelHours = roundUpHalf(hqToPickupHoursRaw);

  // pickup → dropoff used only for fuel + route map. Not its own bill line.
  const pickupToDropoffKm = roadKm(input.pickup, input.dropoff);
  const pickupToDropoffHoursRaw = pickupToDropoffKm / 80 + 0.25;

  const totalDriveMinutes = (hqToPickupHoursRaw + pickupToDropoffHoursRaw) * 60;

  // ── 3. On-site hours + 4-hour minimum ──────────────────────────────────
  const totalRawHours = roundUpHalf(propertyHours + travelHours);
  const totalServiceHours = Math.max(MIN_BILLABLE_HOURS, totalRawHours);
  const minimumApplied = totalServiceHours > totalRawHours;
  const billableOnSiteHours = totalServiceHours - travelHours;
  if (minimumApplied) {
    notes.push(`4-hour minimum applied (${(totalServiceHours - totalRawHours).toFixed(1)} hr added).`);
  }
  const onSiteHours = billableOnSiteHours;

  // ── 4. Customer line items ─────────────────────────────────────────────
  const serviceCostCents = Math.round(onSiteHours * hourlyRateCustomerCents);
  const travelCostCents  = Math.round(travelHours * hourlyRateCustomerCents);
  const materialsCents   = MATERIALS_CENTS;
  const insuranceCents   = 0;

  // Time-based fuel. $50 base covers up to 60 min total drive time
  // (HQ→pickup + pickup→dropoff). Beyond that, +$25 per half-hour, floor.
  const extraMinutes = Math.max(0, totalDriveMinutes - FUEL_BASE_MINUTES);
  const extraHalfHours = Math.floor(extraMinutes / 30);
  const longHaulCustomerCents = FUEL_BASE_CENTS + extraHalfHours * FUEL_PER_HALF_HOUR_CENTS;
  if (extraHalfHours > 0) {
    notes.push(`Fuel: $50 base + ${extraHalfHours} × $25 (long-haul half-hours)`);
  }

  const taxableSubtotalCents =
    serviceCostCents + travelCostCents + materialsCents + longHaulCustomerCents;
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

export function estimatePrice(draft: BookingDraft): PriceBreakdown {
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
function round1(n: number)      { return Math.round(n * 10) / 10; }
