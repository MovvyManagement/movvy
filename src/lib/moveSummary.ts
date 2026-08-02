// =============================================================================
// moveSummary — one place that turns a booking row into human copy.
//
// The crew screens used to show bare placeholders ("TBD", "home move") which
// told a mover nothing about the job they're being sent on. These helpers give
// every crew surface the same, informative description:
//   moveSummary(b)   → "2-bed apartment" / "Office move" / "Single item"
//   moveWhen(b)      → "Sat, Aug 9 · 9:00 AM – 11:00 AM"
//   moveRoute(b)     → "750 Northmount Dr NW → 430 Sage Hill Rd NW"
// =============================================================================

import { fmtDateShort, fmtTime } from '@/lib/format';

type AnyBooking = Record<string, any>;

const DWELLING_LABEL: Record<string, string> = {
  apartment: 'apartment',
  condo: 'condo',
  townhouse: 'townhouse',
  house: 'house',
};

/** "2-bed apartment", "Office move", "Single item" — what KIND of job this is. */
export function moveSummary(b: AnyBooking | null | undefined): string {
  if (!b) return 'Move';
  const details = (b.details ?? {}) as Record<string, any>;
  const type = String(b.move_type ?? '');

  if (type === 'home_move') {
    const beds = Number(details.bedrooms ?? 0);
    const dwelling = DWELLING_LABEL[String(details.dwelling ?? '')] ?? 'home';
    if (beds > 0) return `${beds}-bed ${dwelling}`;
    return `Studio ${dwelling}`;
  }
  if (!type) return 'Move';
  // office_move → "Office move", single_item → "Single item"
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Sat, Aug 9 · 9:00 AM – 11:00 AM" — when the crew is expected. */
export function moveWhen(b: AnyBooking | null | undefined): string {
  if (!b) return '';
  const date = b.scheduled_for_date ? fmtDateShort(b.scheduled_for_date) : '';
  const window =
    b.scheduled_for_window ??
    (b.scheduled_for_window_starts_at ? fmtTime(b.scheduled_for_window_starts_at) : '');
  return [date, window].filter(Boolean).join(' · ');
}

/** "750 Northmount Dr NW → 430 Sage Hill Rd NW" */
export function moveRoute(b: AnyBooking | null | undefined): string {
  if (!b) return '';
  const from = b.pickup_line1 ?? b.pickup?.line1 ?? '';
  const to = b.dropoff_line1 ?? b.dropoff?.line1 ?? 'in-home';
  return `${from} → ${to}`;
}

/** Extra service tags the crew should know about ("Packing", "Assembly"). */
export function moveExtras(b: AnyBooking | null | undefined): string[] {
  const details = ((b?.details ?? {}) as Record<string, any>);
  const out: string[] = [];
  if (details.packing) out.push('Packing');
  if (details.assembly) out.push('Assembly');
  if (details.heavy_items || details.heavyItems) out.push('Heavy items');
  if (details.storage) out.push('Storage');
  const stairs = Number(details.stairs ?? details.flights ?? 0);
  if (stairs > 0) out.push(`${stairs} flight${stairs === 1 ? '' : 's'} of stairs`);
  if (details.elevator) out.push('Elevator');
  return out;
}
