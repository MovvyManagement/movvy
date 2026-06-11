// =============================================================================
// Movvy pricing engine — matrix-based rate card
//
// Rules (locked-in per latest user instruction):
//
// RESIDENTIAL (home_move):
//   Apartment / Condo
//     1 bed → 6 hr · 2 crew · $175/hr
//     2 bed → 8 hr · 2 crew · $175/hr
//     3 bed → 10 hr · 3 crew · $225/hr
//     4+ bed → extrapolated (+2 hr per extra bed, crew 3, $225/hr)
//   Townhouse / House
//     2 bed → 8 hr · 2 crew · $175/hr
//     3 bed → 10 hr · 3 crew · $225/hr
//     4 bed → 12 hr · 3 crew · $225/hr
//     5+ bed → extrapolated (+2 hr per extra bed, crew 4, $225/hr)
//
// COMMERCIAL (with or without truck — same rates):
//     3 crew → $250/hr
//     4 crew → $300/hr
//     5 crew → $350/hr
//     6 crew → $400/hr
//     (2 / 7 / 8 extrapolated at $50/hr per person from $250@3)
//   Customer specifies hours.
//
// SMALL ITEMS / LABOR-ONLY:
//   Fall back to $175/hr · customer-specified crew & hours.
//
// TRAVEL:
//   HQ (closest major city center) → pickup → drop-off, one-way.
//   Intra-city (both inside Calgary OR both inside Edmonton) → 1 hr.
//   Else: distance ÷ 80 km/h + 0.5 hr buffer.
//   Rounded UP to nearest 0.5 hr.
//   Travel cost = travelHours × the SAME hourly rate used for the job.
//
// MATERIALS:
//   Customer pays $50 base · $120 if packing service selected (REPLACES base).
//   Driver always sees $20 — Movvy keeps the rest (covers boxes/wrap supply).
//
// INSURANCE: +$30 if customer opts in. Movvy keeps it (Movvy carries the policy).
//
// TAX: 5% GST on everything taxable (service + travel + materials + insurance).
//      Fuel is no longer a separate line item — folded into travel cost.
//
// TOTAL: ceiling-rounded to nearest $1.
//
// DEPOSIT: 20% of total, NON-REFUNDABLE. Charged at booking. Subtracted from
//          final charge. Final charge can go up or down based on actual hours.
//
// DRIVER SHARE:
//   80% of customer hourly rate for both service AND travel hours.
//   ($175 → $140 · $225 → $180 · $250 → $200 · etc.)
//   Movvy keeps the other 20%.
//
// TIPS (post-completion):
//   Driver gets 90% of tip, Movvy takes 10%.
// =============================================================================

import { estimateRoute, RouteEstimate } from './distance';

// ───── Constants ────────────────────────────────────────────────────────────

const DRIVER_SHARE_OF_RATE   = 0.80;     // 80% to driver, 20% to Movvy

// Materials are a FLAT $50 to the customer regardless of packing.
// Driver always sees $30; Movvy keeps $20.
const MATERIALS_CUSTOMER_CENTS = 5000;
const MATERIALS_DRIVER_CENTS   = 3000;

const INSURANCE_CENTS         = 3000;     // $30 customer (Movvy keeps)

const PACKING_EXTRA_HOURS     = 2;        // packing service still adds 2 hr of on-site time

const TAX_RATE_GST            = 0.05;     // 5% GST on everything taxable
const DEPOSIT_FRACTION        = 0.20;     // 20% non-refundable

const TIP_MOVVY_CUT           = 0.10;
const TIP_DRIVER_SHARE        = 1 - TIP_MOVVY_CUT;

const FALLBACK_RATE_CENTS_PER_HR = 17500; // $175 — small items / labor-only

const MIN_BILLABLE_HOURS      = 4;        // every job has a 4-hour minimum

// Long-haul surcharge — applies when one-way distance exceeds this threshold.
// Covers fuel + truck wear for cross-city moves (Calgary↔Edmonton etc.) on
// top of the hourly travel rate. Customer pays the full $/km; driver gets the
// majority back as a fuel reimbursement on top of their hourly cut.
const LONG_HAUL_THRESHOLD_KM       = 100;
const LONG_HAUL_CUSTOMER_PER_KM_C  = 150;  // $1.50/km customer surcharge
const LONG_HAUL_DRIVER_PER_KM_C    = 100;  // $1.00/km of that goes to driver

// ───── Rate matrix ──────────────────────────────────────────────────────────

export type HomeDwelling = 'apartment' | 'condo' | 'townhouse' | 'house';

export interface JobProfile {
  /** Estimated on-site hours for this property selection. */
  propertyHours: number;
  /** Recommended crew size (informational; the rate is what drives cost). */
  recommendedCrew: number;
  /** Customer-facing hourly rate in cents. */
  hourlyRateCentsPerHr: number;
}

/** Residential lookup — matches the rate card exactly for the defined cells; extrapolates for others. */
export function lookupResidential(dwelling: HomeDwelling, bedrooms: number): JobProfile {
  const beds = Math.max(0, bedrooms);
  const isApt = dwelling === 'apartment' || dwelling === 'condo';
  if (isApt) {
    if (beds <= 1) return { propertyHours: 6,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
    if (beds === 2) return { propertyHours: 8,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
    if (beds === 3) return { propertyHours: 10, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
    return { propertyHours: 10 + (beds - 3) * 2, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  }
  // townhouse / house
  if (beds <= 2) return { propertyHours: 8,  recommendedCrew: 2, hourlyRateCentsPerHr: 17500 };
  if (beds === 3) return { propertyHours: 10, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  if (beds === 4) return { propertyHours: 12, recommendedCrew: 3, hourlyRateCentsPerHr: 22500 };
  return { propertyHours: 12 + (beds - 4) * 2, recommendedCrew: 4, hourlyRateCentsPerHr: 22500 };
}

/**
 * Commercial rate by crew size. 4+ crew requires 2 trucks (mandatory, even if
 * the second truck isn't actively moving stuff). That's why there's a $150 jump
 * from 3-crew to 4-crew.
 *
 *   2 crew · 1 truck  → $200/hr
 *   3 crew · 1 truck  → $250/hr
 *   4 crew · 2 trucks → $400/hr   ← +$150 (second truck mandatory)
 *   5 crew · 2 trucks → $450/hr
 *   6 crew · 2 trucks → $500/hr
 *   7+ extrapolated at +$50/hr/person, still 2 trucks
 */
export interface CommercialQuote {
  rateCentsPerHr: number;
  trucksIncluded: number;
}

export function lookupCommercial(crew: number): CommercialQuote {
  const c = Math.max(2, Math.min(crew, 12));
  if (c === 2) return { rateCentsPerHr: 20000, trucksIncluded: 1 };
  if (c === 3) return { rateCentsPerHr: 25000, trucksIncluded: 1 };
  // 4+ — 2 trucks mandatory, +$50/hr per person from 4@$400
  return { rateCentsPerHr: 40000 + (c - 4) * 5000, trucksIncluded: 2 };
}

/** Legacy single-return variant kept for callers that only want the rate. */
export function lookupCommercialRate(crew: number): number {
  return lookupCommercial(crew).rateCentsPerHr;
}

// ───── Public API ───────────────────────────────────────────────────────────

export interface PricingInput {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  moveType: 'home_move' | 'commercial' | 'single_items' | 'labor_only';

  // Home-move inputs
  dwelling?: HomeDwelling;
  bedrooms?: number;

  // Commercial / labor-only inputs (customer specifies)
  crewSize?: number;
  estimatedHours?: number;     // for commercial / labor_only

  // Add-ons
  packingService?: boolean;
  movingInsurance?: boolean;
  additionalHours?: number;

  // Manual override (admin)
  propertyHoursOverride?: number;
  rateOverrideCentsPerHr?: number;
}

export interface PriceBreakdown {
  // Hours
  travelHours: number;          // actual travel
  propertyHours: number;        // actual on-site (from matrix or customer input)
  packingHours: number;
  additionalHours: number;
  totalServiceHours: number;    // billable, after applying 4-hr minimum
  billableOnSiteHours: number;  // total - travel (after minimum)
  minimumApplied: boolean;      // true if floor padding kicked in
  recommendedCrew: number;
  trucksIncluded: number;       // 1 for residential, 1 or 2 for commercial

  // Rates (cents per hour)
  hourlyRateCustomerCents: number;
  hourlyRateDriverCents: number;

  // ── Customer side (cents) ───────────────────────────────────────────────
  serviceCostCents: number;       // propertyHours × customerRate
  travelCostCents: number;        // travelHours × customerRate
  materialsCents: number;         // 50 or 120
  insuranceCents: number;         // 0 or 30
  /** Cross-city fuel/wear surcharge — zero for intra-city moves. */
  longHaulCustomerCents: number;
  taxableSubtotalCents: number;   // service + travel + materials + insurance + long-haul
  gstCents: number;               // 5% of taxableSubtotal
  totalCents: number;             // ceil to nearest $1
  depositCents: number;           // 20% of total (non-refundable)
  balanceDueOnCompletionCents: number;

  // ── Partner / driver side (cents) ───────────────────────────────────────
  driverServiceCents: number;
  driverTravelCents: number;
  driverMaterialsCents: number;    // flat $20
  /** Driver's cut of the long-haul surcharge (fuel reimbursement). */
  driverLongHaulCents: number;
  driverTotalCents: number;

  // ── Movvy's take (cents) ────────────────────────────────────────────────
  movvyServiceMarginCents: number;
  movvyTravelMarginCents: number;
  movvyMaterialsMarginCents: number;
  movvyInsuranceMarginCents: number;
  /** Movvy's cut of the long-haul surcharge — the rest goes to the driver. */
  movvyLongHaulMarginCents: number;
  movvyTotalMarginCents: number;

  // Diagnostics
  intraCity: boolean;
  routeKm: number;
  route: RouteEstimate;
  notes: string[];
}

export function computePricing(input: PricingInput): PriceBreakdown {
  const notes: string[] = [];

  // 1) Pick the hourly rate + property hours from the matrix
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
    trucksIncluded = 0;  // labor-only = no truck
    // labor_only stays at fallback $175/hr unless overridden
  } else {
    // single_items
    recommendedCrew = 2;
    propertyHours = input.propertyHoursOverride ?? input.estimatedHours ?? 2;
  }

  const hourlyRateDriverCents = Math.round(hourlyRateCustomerCents * DRIVER_SHARE_OF_RATE);

  // 2) Time components — actual
  const route = estimateRoute(input.pickup, input.dropoff);
  // ONE-WAY only: HQ → pickup → dropoff. estimateRoute returns round-trip;
  // divide by 2 for the one-way leg, then add the 0.5-hr handling buffer
  // separately (still 1 hr flat for intra-city).
  const travelHoursRaw = route.intraCity ? 1 : (route.totalKm / 2) / 80 + 0.5;
  const travelHours = roundUpHalf(travelHoursRaw);

  // Packing add-on hours apply ONLY to non-residential flows. Residential
  // presets (1BR apt = 6h, 2BR house = 8h, etc.) already bundle packing +
  // disassembly time into the property-hours returned by lookupResidential,
  // so adding PACKING_EXTRA_HOURS on top would double-count and inflate
  // the estimate (the bug that turned 1BR's 6h into 8h on the confirm screen).
  const packingHours =
    input.packingService && input.moveType !== 'home_move' ? PACKING_EXTRA_HOURS : 0;
  const additionalHours = input.additionalHours ?? 0;

  const onSiteActualHours = propertyHours + packingHours + additionalHours;
  const totalRawHours = roundUpHalf(onSiteActualHours + travelHours);

  // 3) Apply the 4-hour minimum. Travel stays as-is; on-site absorbs the floor.
  const totalServiceHours = Math.max(MIN_BILLABLE_HOURS, totalRawHours);
  const minimumApplied = totalServiceHours > totalRawHours;
  const billableOnSiteHours = totalServiceHours - travelHours;
  if (minimumApplied) {
    notes.push(`4-hour minimum applied (${(totalServiceHours - totalRawHours).toFixed(1)} hr added to on-site time).`);
  }
  // Keep variable name `onSiteHours` for the money math below
  const onSiteHours = billableOnSiteHours;

  // 3) Money (cents) — customer side. Materials are now flat $50 regardless of packing.
  const serviceCostCents = Math.round(onSiteHours * hourlyRateCustomerCents);
  const travelCostCents  = Math.round(travelHours * hourlyRateCustomerCents);
  const materialsCents   = MATERIALS_CUSTOMER_CENTS;
  const insuranceCents   = input.movingInsurance ? INSURANCE_CENTS : 0;

  // Long-haul surcharge — flat fuel + wear charge for cross-city moves
  // (Calgary↔Edmonton, etc) above the threshold. Computed on ONE-WAY km;
  // hourly travel time already covers the in-city portion.
  const oneWayKm = route.intraCity ? 0 : route.totalKm / 2;
  const surchargeKm = Math.max(0, oneWayKm - LONG_HAUL_THRESHOLD_KM);
  const longHaulCustomerCents = Math.round(surchargeKm * LONG_HAUL_CUSTOMER_PER_KM_C);
  const longHaulDriverCents = Math.round(surchargeKm * LONG_HAUL_DRIVER_PER_KM_C);
  if (surchargeKm > 0) {
    notes.push(
      `Long-haul surcharge: ${round1(surchargeKm)} km over ${LONG_HAUL_THRESHOLD_KM} km @ $${(LONG_HAUL_CUSTOMER_PER_KM_C / 100).toFixed(2)}/km`,
    );
  }

  const taxableSubtotalCents = serviceCostCents + travelCostCents + materialsCents + insuranceCents + longHaulCustomerCents;
  const gstCents = Math.round(taxableSubtotalCents * TAX_RATE_GST);
  const totalRaw = taxableSubtotalCents + gstCents;
  const totalCents = Math.ceil(totalRaw / 100) * 100;
  const depositCents = Math.ceil((totalCents * DEPOSIT_FRACTION) / 100) * 100;
  const balanceDueOnCompletionCents = Math.max(0, totalCents - depositCents);

  // 4) Driver side (hours × discounted rate; materials flat; long-haul cut)
  const driverServiceCents   = Math.round(onSiteHours * hourlyRateDriverCents);
  const driverTravelCents    = Math.round(travelHours * hourlyRateDriverCents);
  const driverMaterialsCents = MATERIALS_DRIVER_CENTS;
  const driverLongHaulCents  = longHaulDriverCents;
  const driverTotalCents     = driverServiceCents + driverTravelCents + driverMaterialsCents + driverLongHaulCents;

  // 5) Movvy margin = what customer pays minus what driver gets (per line)
  const movvyServiceMarginCents    = serviceCostCents - driverServiceCents;
  const movvyTravelMarginCents     = travelCostCents - driverTravelCents;
  const movvyMaterialsMarginCents  = materialsCents - driverMaterialsCents;
  const movvyInsuranceMarginCents  = insuranceCents;  // Movvy keeps insurance entirely
  const movvyLongHaulMarginCents   = longHaulCustomerCents - longHaulDriverCents;
  const movvyTotalMarginCents      =
    movvyServiceMarginCents + movvyTravelMarginCents + movvyMaterialsMarginCents + movvyInsuranceMarginCents + movvyLongHaulMarginCents;

  notes.push('Estimate based on selections. Final charge depends on actual time on site.');

  return {
    travelHours: round1(travelHours),
    propertyHours: round1(propertyHours),
    packingHours,
    additionalHours,
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

    driverServiceCents,
    driverTravelCents,
    driverMaterialsCents,
    driverLongHaulCents,
    driverTotalCents,

    movvyServiceMarginCents,
    movvyTravelMarginCents,
    movvyMaterialsMarginCents,
    movvyInsuranceMarginCents,
    movvyLongHaulMarginCents,
    movvyTotalMarginCents,

    intraCity: route.intraCity,
    routeKm: round1(route.totalKm / 2),  // one-way km for display
    route,
    notes,
  };
}

// ───── Tip split (called when customer adds a tip on the review screen) ─────

export interface TipSplit {
  tipCents: number;
  movvyCutCents: number;   // 10%
  driverCents: number;     // 90%
}

export function splitTip(tipCents: number): TipSplit {
  const cleaned = Math.max(0, Math.round(tipCents));
  const movvy = Math.round(cleaned * TIP_MOVVY_CUT);
  const driver = cleaned - movvy;
  return { tipCents: cleaned, movvyCutCents: movvy, driverCents: driver };
}

// ───── Adapter for the BookingDraft shape used by the booking flow ──────────

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
  single_items: 'Single items',   // kept for legacy bookings — not offered to new customers
  labor_only: 'Labor only',       // kept for legacy bookings — not offered to new customers
} as const;

// ───── Internal utils ───────────────────────────────────────────────────────

function roundUpHalf(n: number) { return Math.ceil(n * 2) / 2; }
function round1(n: number)      { return Math.round(n * 10) / 10; }
