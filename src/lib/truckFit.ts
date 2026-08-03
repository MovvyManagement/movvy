// =============================================================================
// truckFit — what truck (and how many people) a move actually needs.
//
// Single source of truth for the capacity matrix. The SAME numbers are mirrored
// in SQL (migration 0082) so the server can enforce what the UI shows — a crew
// must never be able to accept a move their truck can't physically hold.
//
//   1-bed apartment   16 ft
//   2-bed apartment   20 ft
//   3-bed apartment   22 ft   (22–24 band, 22 is the minimum that fits)
//   2-bed house       20 ft   (20–22 band)
//   3-bed house       24 ft   (24–26 band)
//   4-bed house       26 ft
//
// The rule is a MINIMUM, not a match: a bigger truck covers everything smaller.
// A 24 ft truck can take the 3-bed apartment it's sized for and every 1-/2-bed
// job beneath it.
// =============================================================================

type AnyBooking = Record<string, any>;

/** Truck lengths a partner can register, in feet. */
export const TRUCK_LENGTHS: { ft: number; label: string }[] = [
  { ft: 10, label: '10 ft (cargo van)' },
  { ft: 16, label: '16 ft' },
  { ft: 20, label: '20 ft' },
  { ft: 22, label: '22 ft' },
  { ft: 24, label: '24 ft' },
  { ft: 26, label: '26 ft' },
];

const HOUSE_LIKE = new Set(['house', 'townhouse']);

/**
 * Minimum truck length (ft) that can carry this move. Returns 0 when the move
 * has no size signal (labour-only, single item) — those aren't truck-gated.
 */
export function requiredTruckFt(b: AnyBooking | null | undefined): number {
  if (!b) return 0;
  const type = String(b.move_type ?? '');
  if (type !== 'home_move') return 0; // office/labour/single-item aren't gated here

  const details = (b.details ?? {}) as Record<string, any>;
  const beds = Number(details.bedrooms ?? 0);
  const isHouse = HOUSE_LIKE.has(String(details.dwelling ?? ''));

  if (isHouse) {
    if (beds >= 4) return 26;
    if (beds === 3) return 24;
    return 20; // 1–2 bed house
  }
  // apartment / condo
  if (beds >= 4) return 26;
  if (beds === 3) return 22;
  if (beds === 2) return 20;
  return 16; // studio / 1-bed
}

/**
 * How many crew this move needs on site.
 *
 * MUST match what the customer was quoted — they booked "a 3-person crew" and
 * priced it at the 3-crew rate, so the partner has to see the same number.
 * Home moves therefore read the SAME residential table pricing.ts uses; every
 * other move type carries an explicit crew size from the booking flow.
 */
export function requiredCrew(b: AnyBooking | null | undefined): number {
  const details = ((b?.details ?? {}) as Record<string, any>);
  // Commercial + labour-only bookings carry an explicit crew size already.
  const explicit = Number(details.crewSize ?? details.crew_size ?? 0);
  if (explicit > 0) return explicit;

  if (String(b?.move_type ?? '') !== 'home_move') return 2;

  const beds = Number(details.bedrooms ?? 0);
  const isHouse = HOUSE_LIKE.has(String(details.dwelling ?? ''));
  if (isHouse) {
    if (beds <= 2) return 2;
    if (beds <= 4) return 3;
    return 4;
  }
  return beds <= 2 ? 2 : 3;
}

/** True when a truck of `truckFt` can take this move. */
export function truckFits(truckFt: number | null | undefined, b: AnyBooking): boolean {
  const need = requiredTruckFt(b);
  if (need === 0) return true;
  return (truckFt ?? 0) >= need;
}

/** "Needs a 24 ft truck · 3 crew" — one line for a job card. */
export function requirementLabel(b: AnyBooking | null | undefined): string {
  const ft = requiredTruckFt(b);
  const crew = requiredCrew(b);
  const people = `${crew} crew`;
  return ft > 0 ? `Needs ${ft} ft truck · ${people}` : `Needs ${people}`;
}

// -----------------------------------------------------------------------------
// The accept gate, in plain English.
//
// org_can_take_booking() (migration 0084) is the authority and will refuse the
// job server-side. But a raw 400 reads as "Edge Function returned a non-2xx
// status code" to the driver, so every Accept button asks this first and shows
// the real reason. Mirrors the server's order of checks exactly.
// -----------------------------------------------------------------------------

export interface FleetLike {
  truck_count: number;
  max_truck_ft: number;
  registration: { status: string; rejection_reason?: string | null };
}

export interface AcceptBlock {
  title: string;
  body: string;
  /** 'fleet' → send them to Trucks; 'size' → nothing to fix, leave the job. */
  fix: 'fleet' | 'size';
}

/** Why this crew can't accept this move, or null when they can. */
export function acceptBlock(
  fleet: FleetLike | null | undefined,
  booking: AnyBooking | null | undefined,
): AcceptBlock | null {
  if (!fleet) return null; // readiness hasn't loaded — let the server decide

  if ((fleet.truck_count ?? 0) === 0) {
    return {
      title: 'Add your truck first',
      body: 'Jobs are matched to your box size, so we need the truck — plus its registration and insurance — before you can accept anything.',
      fix: 'fleet',
    };
  }

  const reg = fleet.registration?.status ?? 'missing';
  if (reg === 'pending') {
    return {
      title: 'Registration still in review',
      body: "Movvy is checking your truck registration. The moment it's approved you can accept jobs — usually within one business day.",
      fix: 'fleet',
    };
  }
  if (reg === 'rejected') {
    return {
      title: 'Registration needs changes',
      body:
        fleet.registration?.rejection_reason ??
        'Movvy sent your registration back. Re-upload it from your Trucks screen.',
      fix: 'fleet',
    };
  }
  if (reg !== 'approved') {
    return {
      title: 'Truck registration required',
      body: 'Upload your truck registration and insurance from the Trucks screen. Once Movvy approves the registration you can accept jobs.',
      fix: 'fleet',
    };
  }

  // Feeds that already carry the server-computed requirement (dispatch_queue,
  // org_open_jobs) win; anything else is derived from the booking's details.
  const need =
    typeof booking?.required_truck_ft === 'number'
      ? booking.required_truck_ft
      : requiredTruckFt(booking);
  const have = fleet.max_truck_ft ?? 0;
  if (need > 0 && have < need) {
    return {
      title: 'Your truck is too small for this move',
      body: `This move needs a ${need} ft truck and your largest is ${have} ft. Leave it for a crew with a bigger truck — you'll still see everything you can carry.`,
      fix: 'size',
    };
  }

  return null;
}

/** Why an accept is blocked, or null when the org can take it. */
export function blockedReason(
  b: AnyBooking,
  opts: { maxTruckFt: number | null; hasTruck: boolean; registrationOk: boolean },
): string | null {
  if (!opts.hasTruck) return 'Add your truck before accepting jobs';
  if (!opts.registrationOk) return 'Upload your truck registration to accept jobs';
  const need = requiredTruckFt(b);
  if (need > 0 && (opts.maxTruckFt ?? 0) < need) {
    return `Needs a ${need} ft truck — yours is ${opts.maxTruckFt ?? 0} ft`;
  }
  return null;
}
