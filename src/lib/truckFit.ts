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

/** How many crew this move needs on site. */
export function requiredCrew(b: AnyBooking | null | undefined): number {
  const details = ((b?.details ?? {}) as Record<string, any>);
  // Commercial + labour-only bookings carry an explicit crew size already.
  const explicit = Number(details.crewSize ?? details.crew_size ?? 0);
  if (explicit > 0) return explicit;

  const ft = requiredTruckFt(b);
  if (ft === 0) return 2;
  return ft >= 22 ? 3 : 2;
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
