// Edge-function pricing — MUST stay in sync with src/lib/pricing.ts.
// The server is authoritative; never trust the client's total.
// All money returned in CENTS (integer).

const DRIVER_SHARE_OF_RATE     = 0.80;
const MATERIALS_CUSTOMER_CENTS = 5000;  // flat $50
const MATERIALS_DRIVER_CENTS   = 3000;  // $30 to driver, $20 to Movvy
const INSURANCE_CENTS          = 3000;
const PACKING_EXTRA_HOURS      = 2;
const TAX_RATE_GST             = 0.05;
const DEPOSIT_FRACTION         = 0.20;
const FALLBACK_RATE_CENTS_PER_HR = 17500;
const MIN_BILLABLE_HOURS       = 4;    // 4-hour minimum on every job

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
function closestMajor(c: { lat: number; lng: number }) {
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

// 2 crew → $200 (1 truck) · 3 crew → $250 (1 truck)
// 4 crew → $400 (2 trucks mandatory) · 5 → $450 · 6 → $500 · +$50/crew after.
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
  packingService?: boolean;
  movingInsurance?: boolean;
  additionalHours?: number;
}

export interface ServerPriceBreakdown {
  travelHours: number;
  propertyHours: number;
  packingHours: number;
  additionalHours: number;
  totalServiceHours: number;
  billableOnSiteHours: number;
  minimumApplied: boolean;
  recommendedCrew: number;
  trucksIncluded: number;

  hourlyRateCustomerCents: number;
  hourlyRateDriverCents: number;

  serviceCostCents: number;
  travelCostCents: number;
  materialsCents: number;
  insuranceCents: number;
  taxableSubtotalCents: number;
  gstCents: number;
  totalCents: number;
  depositCents: number;
  balanceDueOnCompletionCents: number;

  driverServiceCents: number;
  driverTravelCents: number;
  driverMaterialsCents: number;
  driverTotalCents: number;

  movvyServiceMarginCents: number;
  movvyTravelMarginCents: number;
  movvyMaterialsMarginCents: number;
  movvyInsuranceMarginCents: number;
  movvyTotalMarginCents: number;

  intraCity: boolean;
  routeKm: number;
}

const roundUpHalf = (n: number) => Math.ceil(n * 2) / 2;

export function computeServerPricing(input: ServerPricingInput): ServerPriceBreakdown {
  // Rate + property hours
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

  const hourlyRateDriverCents = Math.round(hourlyRateCustomerCents * DRIVER_SHARE_OF_RATE);

  // Travel (one-way: HQ → pickup → dropoff)
  const pCity = cityForCoord(input.pickup);
  const dCity = cityForCoord(input.dropoff);
  const intraCity = !!pCity && pCity === dCity;
  let totalKmRoundTrip = 0;
  let travelHoursRaw = 1;
  if (!intraCity) {
    const origin = closestMajor(input.pickup);
    const oneWayKm =
      roadKm(origin, input.pickup) + roadKm(input.pickup, input.dropoff);
    // Round trip exists in src/lib/distance for backwards compat — server only
    // needs the one-way leg for the customer travel charge.
    totalKmRoundTrip = oneWayKm * 2;  // for diagnostic display only
    travelHoursRaw = oneWayKm / 80 + 0.5;
  }
  const travelHours = roundUpHalf(travelHoursRaw);

  const packingHours = input.packingService ? PACKING_EXTRA_HOURS : 0;
  const additionalHours = input.additionalHours ?? 0;

  // Actual hours, then enforce 4-hour minimum. Travel stays as-is; on-site absorbs floor.
  const onSiteActualHours = propertyHours + packingHours + additionalHours;
  const totalRawHours = roundUpHalf(onSiteActualHours + travelHours);
  const totalServiceHours = Math.max(MIN_BILLABLE_HOURS, totalRawHours);
  const minimumApplied = totalServiceHours > totalRawHours;
  const billableOnSiteHours = totalServiceHours - travelHours;
  const onSiteHours = billableOnSiteHours;  // keep local var name for money math below

  // Money — materials are FLAT $50 (no packing tier)
  const serviceCostCents = Math.round(onSiteHours * hourlyRateCustomerCents);
  const travelCostCents  = Math.round(travelHours * hourlyRateCustomerCents);
  const materialsCents   = MATERIALS_CUSTOMER_CENTS;
  const insuranceCents   = input.movingInsurance ? INSURANCE_CENTS : 0;
  const taxableSubtotalCents = serviceCostCents + travelCostCents + materialsCents + insuranceCents;
  const gstCents = Math.round(taxableSubtotalCents * TAX_RATE_GST);
  const totalRaw = taxableSubtotalCents + gstCents;
  const totalCents = Math.ceil(totalRaw / 100) * 100;
  const depositCents = Math.ceil((totalCents * DEPOSIT_FRACTION) / 100) * 100;
  const balanceDueOnCompletionCents = Math.max(0, totalCents - depositCents);

  // Driver
  const driverServiceCents   = Math.round(onSiteHours * hourlyRateDriverCents);
  const driverTravelCents    = Math.round(travelHours * hourlyRateDriverCents);
  const driverMaterialsCents = MATERIALS_DRIVER_CENTS;
  const driverTotalCents     = driverServiceCents + driverTravelCents + driverMaterialsCents;

  // Movvy
  const movvyServiceMarginCents    = serviceCostCents - driverServiceCents;
  const movvyTravelMarginCents     = travelCostCents - driverTravelCents;
  const movvyMaterialsMarginCents  = materialsCents - driverMaterialsCents;
  const movvyInsuranceMarginCents  = insuranceCents;
  const movvyTotalMarginCents      =
    movvyServiceMarginCents + movvyTravelMarginCents + movvyMaterialsMarginCents + movvyInsuranceMarginCents;

  return {
    travelHours,
    propertyHours: Math.round(propertyHours * 10) / 10,
    packingHours,
    additionalHours,
    totalServiceHours,
    billableOnSiteHours: Math.round(billableOnSiteHours * 10) / 10,
    minimumApplied,
    recommendedCrew,
    trucksIncluded,

    hourlyRateCustomerCents,
    hourlyRateDriverCents,

    serviceCostCents,
    travelCostCents,
    materialsCents,
    insuranceCents,
    taxableSubtotalCents,
    gstCents,
    totalCents,
    depositCents,
    balanceDueOnCompletionCents,

    driverServiceCents,
    driverTravelCents,
    driverMaterialsCents,
    driverTotalCents,

    movvyServiceMarginCents,
    movvyTravelMarginCents,
    movvyMaterialsMarginCents,
    movvyInsuranceMarginCents,
    movvyTotalMarginCents,

    intraCity,
    routeKm: Math.round((totalKmRoundTrip / 2) * 10) / 10,
  };
}

export function splitTip(tipCents: number) {
  const cleaned = Math.max(0, Math.round(tipCents));
  const movvy = Math.round(cleaned * TIP_MOVVY_CUT);
  return { tipCents: cleaned, movvyCutCents: movvy, driverCents: cleaned - movvy };
}
