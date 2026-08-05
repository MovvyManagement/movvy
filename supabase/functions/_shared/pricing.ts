// =============================================================================
// Edge-function pricing — the AUTHORITATIVE source of every dollar Movvy
// quotes, charges, pays out, or collects.
//
// MUST stay byte-for-byte equivalent with src/lib/pricing.ts. They are
// separate files only because edge functions can't import from the mobile
// app. Every constant and formula below also appears in src/lib/pricing.ts
// with the same value. If you change one, change the other.
//
// ─── ACTUAL-TIME BILLING (the real model) ─────────────────────────────────
//
// Movvy bills the customer for the ACTUAL time the crew spent on their
// move — not the estimate. The estimate is just a sales-time quote so
// the customer can plan + Movvy can match crew size.
//
// Move day flow:
//   1. Driver presses "I've left HQ"  → status: on_the_way  (NOT BILLED)
//   2. Driver presses "Begin Move"    → status: arrived → started_at = now()
//                                       BILLING TIMER STARTS HERE
//   3. (Optional) status updates between loading / in_transit / unloading
//   4. Driver presses "Finish Move"   → status: completed → completed_at = now()
//                                       BILLING TIMER STOPS HERE
//
// At step 4, the server runs computeActualBill() to turn the elapsed
// (completed_at − started_at) into the final invoice.
//
// HQ → pickup commute is DRIVER'S COST. Customer never sees it on a bill.
// The "travel time" line in the customer estimate is the PICKUP → DROPOFF
// drive only — same intra-property time the actual timer would capture.
//
// ─── Customer-facing estimate math (shown at booking) ─────────────────────
//
// 1. Property hours + crew + hourly rate from the bedroom matrix:
//      Apartment / Condo
//        1 bed → 6h · 2 crew · $175/hr
//        2 bed → 8h · 2 crew · $175/hr
//        3 bed → 10h · 3 crew · $225/hr
//      House / Townhouse
//        2 bed → 8h · 2 crew · $175/hr
//        3 bed → 10h · 3 crew · $225/hr
//        4 bed → 12h · 3 crew · $225/hr
//      4 bed+ apt / 5 bed+ house extrapolate at +2h per bed, larger crew.
//      Commercial: 3 crew $250/hr, 4+ crew $400 base +$50/crew (2 trucks).
//      Labor-only / single items: fallback $175/hr, customer-specified hours.
//
// 2. Add travel time × the SAME hourly rate. Travel = pickup → dropoff
//    drive ONLY (HQ commute is not customer's problem).
//    Intra-city (both inside Calgary OR both inside Edmonton) → 0.5 hr est.
//    Cross-city → pickup→dropoff km ÷ 80 km/h + 0.5 hr buffer, rounded up.
//
// 3. Add fuel ONLY for long-haul (pickup→dropoff > 100 km) at $1.50/km.
//
// 4. Add materials — flat $50 for every move.
//
// 5. GST = 5% on the pre-tax subtotal.
//
// 6. Total = ceil(subtotal + GST) rounded up to the nearest dollar.
//
// ─── Actual bill math (after move completes) ──────────────────────────────
//
//   actual_hours = (completed_at − started_at) hours, 2 decimal places
//   actual_service = actual_hours × hourlyRate
//   actual_subtotal = actual_service + materials + fuel
//   actual_gst = actual_subtotal × 5%
//   actual_total = ceil(actual_subtotal + actual_gst, nearest $)
//
// NO CAP on overruns — customer pays the actual hours, period. If the
// crew finishes early they pay less. If the move runs over, they pay more.
//
// ─── Driver / partner split (locked-in) ───────────────────────────────────
//
//   driver_payout = actual_total × 0.80
//   movvy_commission = actual_total × 0.20  (Movvy remits GST out of this)
//
// The driver UI shows ONE number — the payout. No commission line, no
// breakdown. Same rule applies to the estimate while the move is in flight.
//
// Deposit (20% non-refundable) is computed off the ESTIMATE at booking
// time. Tips are 90% to driver / 10% to Movvy, unchanged.
//
// All money in CENTS (integer) — never floats.
// =============================================================================

const DRIVER_SHARE_OF_TOTAL    = 0.80;   // 80% of customer total goes to the driver
const MATERIALS_CENTS          = 5000;   // flat $50 — never varies, never split
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
// drive time (HQ → pickup + pickup → dropoff) exceeds 60 minutes, we
// add $25 for each additional half-hour rounded down. Replaces the old
// $/km long-haul concept — simpler for customer, simpler for driver.
const FUEL_BASE_CENTS          = 5000;   // $50 covers everything up to 60 min
const FUEL_PER_HALF_HOUR_CENTS = 2500;   // $25 per additional half-hour
const FUEL_BASE_MINUTES        = 60;     // first hour included in the base

const TIP_MOVVY_CUT            = 0.10;

const CALGARY  = { n: 51.2125, s: 50.8425, e: -113.8585, w: -114.2710, c: { lat: 51.0447, lng: -114.0719 } };
const EDMONTON = { n: 53.7099, s: 53.3955, e: -113.2902, w: -113.7106, c: { lat: 53.5461, lng: -113.4938 } };

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const roadKm = (a: any, b: any) => haversineKm(a, b) * 1.30;

function cityForCoord(c: { lat: number; lng: number }): 'calgary' | 'edmonton' | null {
  if (c.lat >= CALGARY.s && c.lat <= CALGARY.n && c.lng >= CALGARY.w && c.lng <= CALGARY.e) return 'calgary';
  if (c.lat >= EDMONTON.s && c.lat <= EDMONTON.n && c.lng >= EDMONTON.w && c.lng <= EDMONTON.e) return 'edmonton';
  return null;
}
export function closestMajor(c: { lat: number; lng: number }) {
  return haversineKm(c, CALGARY.c) <= haversineKm(c, EDMONTON.c) ? CALGARY.c : EDMONTON.c;
}

// ─── Rate-card lookups ───────────────────────────────────────────────────────

function lookupResidential(dwelling: string, bedrooms: number) {
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

function lookupCommercial(crew: number): { rateCentsPerHr: number; trucksIncluded: number } {
  const c = Math.max(2, Math.min(crew, 12));
  if (c === 2) return { rateCentsPerHr: 20000, trucksIncluded: 1 };
  if (c === 3) return { rateCentsPerHr: 25000, trucksIncluded: 1 };
  return { rateCentsPerHr: 40000 + (c - 4) * 5000, trucksIncluded: 2 };
}

// ─── Server pricing input + output ───────────────────────────────────────────

export interface ServerPricingInput {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  moveType: 'home_move' | 'commercial' | 'single_items' | 'labor_only';
  dwelling?: string;
  bedrooms?: number;
  crewSize?: number;
  estimatedHours?: number;
  // Kept for callers that pass them — currently no-op so the breakdown
  // matches the founder's rules (no silent add-ons inflating the total).
  packingService?: boolean;
  movingInsurance?: boolean;
  additionalHours?: number;

  /**
   * Real driving legs from Google Routes. Distance now sets the price directly
   * — both travel lines AND the 100 km round-trip switch — so a straight-line
   * guess is no longer good enough. Absent, we fall back to haversine × 1.30 at
   * 80 km/h, which reads Calgary → Red Deer as 178 km against a real 150.
   */
  route?: {
    hqToPickupKm: number;
    hqToPickupMinutes: number;
    pickupToDropoffKm: number;
    pickupToDropoffMinutes: number;
  };
}

// Many of these fields are kept at 0/legacy values so the existing bookings
// table INSERT in bookings-create doesn't have to change column-by-column.
// The only fields that carry meaningful values now are flagged ★.
export interface ServerPriceBreakdown {
  travelHours: number;            // HQ → pickup, billed
  transportHours: number;         // ★ pickup → drop-off, billed (doubled past 100 km)
  isLongHaul: boolean;            // ★ true when transit is charged per km, not hourly
  transitCents: number;           // ★ fixed transit charge on a long haul
  transportKm: number;            // ★ one-way pickup → drop-off distance
  propertyHours: number;          // ★ from the bedroom matrix
  packingHours: number;           // legacy — always 0 now
  additionalHours: number;        // legacy — always 0 now
  totalServiceHours: number;      // ★ on-site + travel, billable
  billableOnSiteHours: number;    // ★ on-site portion (= property if above min)
  minimumApplied: boolean;        // 4-hour minimum kicked in
  recommendedCrew: number;        // ★ from the matrix
  trucksIncluded: number;

  hourlyRateCustomerCents: number;  // ★
  hourlyRateDriverCents: number;    // legacy — used only for display compat

  // Customer line items ────────────────────────────────────────────────────
  serviceCostCents: number;       // ★ onSiteHours × hourlyRate
  travelCostCents: number;        // travelHours × hourlyRate
  transportCostCents: number;     // transportHours × hourlyRate
  materialsCents: number;         // ★ flat $50
  insuranceCents: number;         // legacy — always 0
  /** Long-haul fuel ($1.50/km over 100km one-way). Customer-only line. */
  longHaulCustomerCents: number;  // ★
  taxableSubtotalCents: number;   // ★ service + travel + materials + fuel
  gstCents: number;               // ★ 5% of subtotal
  totalCents: number;             // ★ ceil(subtotal + gst, nearest $)
  depositCents: number;
  balanceDueOnCompletionCents: number;

  // Driver side ────────────────────────────────────────────────────────────
  // We no longer split per-line. driverTotalCents = totalCents × 0.80.
  // The per-line columns stay at 0 so legacy DB insert code keeps working.
  driverServiceCents: number;
  driverTravelCents: number;
  driverMaterialsCents: number;
  driverTotalCents: number;       // ★ THE single number drivers see

  // Movvy take ─────────────────────────────────────────────────────────────
  movvyServiceMarginCents: number;
  movvyTravelMarginCents: number;
  movvyMaterialsMarginCents: number;
  movvyInsuranceMarginCents: number;
  movvyTotalMarginCents: number;  // ★ THE total commission

  intraCity: boolean;
  routeKm: number;
}

const roundUpHalf = (n: number) => Math.ceil(n * 2) / 2;
/** Nearest half hour, never less than one. */
const roundHalfMin = (n: number) => Math.max(0.5, Math.round(n * 2) / 2);

export function computeServerPricing(input: ServerPricingInput): ServerPriceBreakdown {
  // ── 1. Hours + rate from the matrix ────────────────────────────────────
  let propertyHours = 0;
  let recommendedCrew = 2;
  let hourlyRateCustomerCents = FALLBACK_RATE_CENTS_PER_HR;
  let trucksIncluded = 1;

  if (input.moveType === 'home_move') {
    const r = lookupResidential(input.dwelling ?? 'apartment', input.bedrooms ?? 1);
    propertyHours = r.propertyHours;
    recommendedCrew = r.recommendedCrew;
    hourlyRateCustomerCents = r.hourlyRateCentsPerHr;
  } else if (input.moveType === 'commercial') {
    recommendedCrew = input.crewSize ?? 3;
    propertyHours = input.estimatedHours ?? 4;
    const c = lookupCommercial(recommendedCrew);
    hourlyRateCustomerCents = c.rateCentsPerHr;
    trucksIncluded = c.trucksIncluded;
  } else if (input.moveType === 'labor_only') {
    recommendedCrew = input.crewSize ?? 2;
    propertyHours = input.estimatedHours ?? 2;
    trucksIncluded = 0;
  } else {
    propertyHours = input.estimatedHours ?? 2;
  }

  // hourlyRateDriverCents kept for legacy DB columns; the per-line driver
  // split is no longer used, so this is just hourlyRate × 0.8 for display
  // compatibility with screens that haven't been migrated.
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
  const origin = closestMajor(input.pickup);
  const pCity = cityForCoord(input.pickup);
  const dCity = cityForCoord(input.dropoff);
  const intraCity = !!pCity && pCity === dCity;

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

  // Only used by the LOCAL fuel line — a long haul has no separate fuel charge.
  const totalDriveMinutes = (hqToPickupHoursRaw + pickupToDropoffHoursRaw) * 60;

  // ── 3. On-site hours + 4-hour minimum ──────────────────────────────────
  // No more silent packing-hour inflation. The matrix property hours ARE
  // the on-site bill. The 4-hour floor still applies — small jobs round up.
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
  const onSiteHours = billableOnSiteHours;

  // ── 4. Customer line items ─────────────────────────────────────────────
  const serviceCostCents = Math.round(onSiteHours * hourlyRateCustomerCents);
  const travelCostCents     = Math.round(travelHours * hourlyRateCustomerCents);
  const transportCostCents  = Math.round(transportHours * hourlyRateCustomerCents);
  const materialsCents   = MATERIALS_CENTS;
  const insuranceCents   = 0;  // line removed

  // Time-based fuel. $50 covers the first hour of total drive time
  // (HQ → pickup + pickup → dropoff). Each additional half-hour adds $25,
  // rounded down so a partial 15-min segment doesn't get billed.
  // Long-haul fuel is already inside the per-km transit charge — billing the
  // time-based line on top would charge the same diesel twice.
  const extraMinutes = Math.max(0, totalDriveMinutes - FUEL_BASE_MINUTES);
  const extraHalfHours = Math.floor(extraMinutes / 30);
  const longHaulCustomerCents = isLongHaul
    ? 0
    : FUEL_BASE_CENTS + extraHalfHours * FUEL_PER_HALF_HOUR_CENTS;

  const taxableSubtotalCents =
    serviceCostCents + travelCostCents + transportCostCents + transitCents +
    materialsCents + longHaulCustomerCents;
  const gstCents = Math.round(taxableSubtotalCents * TAX_RATE_GST);
  const totalRaw = taxableSubtotalCents + gstCents;
  const totalCents = Math.ceil(totalRaw / 100) * 100;
  const depositCents = Math.ceil((totalCents * DEPOSIT_FRACTION) / 100) * 100;
  const balanceDueOnCompletionCents = Math.max(0, totalCents - depositCents);

  // ── 5. Driver payout + Movvy commission ────────────────────────────────
  // Single rule: driver gets 80% of what the customer pays. Movvy keeps
  // the rest (which is where GST remittance comes from too). This is the
  // ONLY number the driver UI shows.
  const driverTotalCents = Math.round(totalCents * DRIVER_SHARE_OF_TOTAL);
  const movvyTotalMarginCents = totalCents - driverTotalCents;

  return {
    travelHours,
    transportHours: Math.round(transportHours * 10) / 10,
    isLongHaul,
    transitCents,
    transportKm: Math.round(pickupToDropoffKm * 10) / 10,
    propertyHours: Math.round(propertyHours * 10) / 10,
    packingHours: 0,
    additionalHours: 0,
    totalServiceHours,
    billableOnSiteHours: Math.round(billableOnSiteHours * 10) / 10,
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

    // Per-line driver columns: kept at 0 so the existing INSERT in
    // bookings-create doesn't choke on missing fields. The truth lives
    // in driverTotalCents.
    driverServiceCents: 0,
    driverTravelCents: 0,
    driverMaterialsCents: 0,
    driverTotalCents,

    movvyServiceMarginCents: 0,
    movvyTravelMarginCents: 0,
    movvyMaterialsMarginCents: 0,
    movvyInsuranceMarginCents: 0,
    movvyTotalMarginCents,

    intraCity,
    // routeKm now reports the pickup → dropoff one-way distance (what
    // the customer sees on the map). HQ → pickup is computed but not
    // surfaced as a distance — only as the "travel time" hours.
    routeKm: Math.round(pickupToDropoffKm * 10) / 10,
  };
}

export function splitTip(tipCents: number) {
  const cleaned = Math.max(0, Math.round(tipCents));
  const movvy = Math.round(cleaned * TIP_MOVVY_CUT);
  return { tipCents: cleaned, movvyCutCents: movvy, driverCents: cleaned - movvy };
}

// ─── Actual-bill calculator ──────────────────────────────────────────────────
//
// Called from the bookings-update-status edge function the moment the driver
// presses "Finish Move" (status → completed). Takes the start/end timestamps
// recorded on the bookings row + the rate-card + fuel/materials that were
// frozen at booking time, and returns the final invoice numbers.
//
// Rule: customer pays for what actually happened. No cap, no minimum on
// short jobs (the booking already enforces the 4-hour minimum at estimate
// time, but if the actual is shorter the customer keeps the savings).

export interface ActualBillInput {
  startedAt: Date | string;
  completedAt: Date | string;
  /** Hourly rate captured at booking creation, in cents. */
  hourlyRateCustomerCents: number;
  /** Materials charge captured at booking creation (usually flat $50). */
  materialsCents: number;
  /** Fuel surcharge captured at booking creation. 0 on long hauls. */
  fuelCents: number;

  // ── Long-haul only ──────────────────────────────────────────────────────
  /** Quoted at booking. When set, transit is NOT billed by the clock. */
  isLongHaul?: boolean;
  /** The fixed transit charge the customer agreed to (km × rate). */
  transitCents?: number;
  /**
   * When the crew pressed "in transit" and "unloading". The span between them
   * is the highway drive — it comes OFF the clock on a long haul, because the
   * customer is paying for that distance, not that duration. Absent (crew
   * skipped a status), we fall back to the quoted transit duration so a missed
   * button press can't silently bill hours of driving at the hourly rate.
   */
  inTransitAt?: Date | string | null;
  unloadingAt?: Date | string | null;
  /** Quoted transit duration, used as the fallback deduction. */
  quotedTransitMinutes?: number;
}

export interface ActualBillOutput {
  actualHours: number;            // 2-decimal places, e.g. 6.42
  /** Hours removed from the clock because transit was billed per km. */
  transitHoursExcluded: number;
  actualServiceCents: number;     // actual_hours × hourlyRate
  actualSubtotalCents: number;    // service + materials + fuel
  actualGstCents: number;         // 5% of subtotal
  actualTotalCents: number;       // ceil(subtotal + gst, $1)
  actualDriverPayoutCents: number; // 80% of actual_total
  actualCommissionCents: number;   // 20% — Movvy keeps this (GST + take)
}

export function computeActualBill(input: ActualBillInput): ActualBillOutput {
  const start = new Date(input.startedAt).getTime();
  const end = new Date(input.completedAt).getTime();
  const elapsedMs = Math.max(0, end - start);
  // Two-decimal hours so a 6h22m move bills as 6.37 hr (rounded to nearest
  // 1/100 hr ~= 36 sec). Plenty of resolution; no rounding-up scam.
  let hours = elapsedMs / 3_600_000;

  // On a long haul the highway is already paid for by the kilometre. Take it
  // off the clock so the crew isn't paid twice for the same drive — and so a
  // slow day on the QE2 doesn't land on the customer's invoice.
  let transitHoursExcluded = 0;
  if (input.isLongHaul) {
    const t0 = input.inTransitAt ? new Date(input.inTransitAt).getTime() : NaN;
    const t1 = input.unloadingAt ? new Date(input.unloadingAt).getTime() : NaN;
    const measured = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0
      ? (t1 - t0) / 3_600_000
      : NaN;
    transitHoursExcluded = Number.isFinite(measured)
      ? measured
      : (input.quotedTransitMinutes ?? 0) / 60;
    hours = Math.max(0, hours - transitHoursExcluded);
  }

  const actualHours = Math.round(hours * 100) / 100;
  transitHoursExcluded = Math.round(transitHoursExcluded * 100) / 100;

  const actualServiceCents  = Math.round(actualHours * input.hourlyRateCustomerCents);
  const actualSubtotalCents =
    actualServiceCents + input.materialsCents + input.fuelCents + (input.transitCents ?? 0);
  const actualGstCents      = Math.round(actualSubtotalCents * TAX_RATE_GST);
  const actualTotalRaw      = actualSubtotalCents + actualGstCents;
  const actualTotalCents    = Math.ceil(actualTotalRaw / 100) * 100;

  const actualDriverPayoutCents = Math.round(actualTotalCents * DRIVER_SHARE_OF_TOTAL);
  const actualCommissionCents   = actualTotalCents - actualDriverPayoutCents;

  return {
    actualHours,
    transitHoursExcluded,
    actualServiceCents,
    actualSubtotalCents,
    actualGstCents,
    actualTotalCents,
    actualDriverPayoutCents,
    actualCommissionCents,
  };
}
