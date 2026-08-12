// =============================================================================
// Booking row → ReceiptData adapter
//
// One place to translate a DbBooking (plus the customer's profile) into the
// shape our HTML receipt + PDF consume. Keeps the receipt screen dumb: pass a
// booking, get a printable PDF.
//
// TWO RULES, because this document is what a customer hands their accountant:
//
//  1. Every charge that made it into the total appears as a line. The old
//     version listed move time / travel / materials / insurance / GST and
//     silently dropped fuel_cents and transit_cents. Transit is the per-km
//     long-haul charge at $4.00/km — on an Edmonton→Calgary move that is over
//     a thousand dollars of invisible charge, and fuel is $50–$150 on nearly
//     every local move.
//
//  2. The lines RECONCILE to the printed total, always. They used to be built
//     from the ESTIMATE columns while the total came from actual_total_cents,
//     so on any completed move the column of numbers simply didn't add up to
//     the figure underneath it. Now the lines come from whichever bill the
//     total comes from, and any residual (the engine ceils the total to a
//     whole dollar) is emitted as its own labelled line rather than left as an
//     unexplained gap. reconcile() below makes a non-summing receipt
//     structurally impossible.
//
// Estimate vs actual is BY DESIGN, not a discrepancy: the estimate sizes the
// deposit, the actual is billed from the time the move really took. A receipt
// is issued against the actual — so it says so, and shows the deposit already
// paid and the balance charged on completion.
// =============================================================================

import type { ReceiptData, ReceiptLine } from './receipt';
import { TRANSIT_CENTS_PER_KM } from './pricing';

interface ReceiptBookingInput {
  short_code: string;
  move_type: string;
  scheduled_for_date: string;
  scheduled_for_window?: string | null;
  completed_at?: string | null;
  pickup_line1: string;
  pickup_city: string;
  dropoff_line1?: string | null;
  dropoff_city?: string | null;

  /** Estimate side — what the deposit was taken against. */
  service_cost_cents?: number | null;
  travel_cost_cents?: number | null;
  materials_cents?: number | null;
  insurance_cents?: number | null;
  fuel_cents?: number | null;
  transit_cents?: number | null;
  transit_km?: number | null;
  gst_cents?: number | null;
  price_subtotal_cents?: number | null;
  price_tax_cents?: number | null;
  price_total_cents: number;
  total_service_hours?: number | null;

  /** Actual side — the timed bill, present once the move is completed. */
  actual_hours?: number | null;
  actual_subtotal_cents?: number | null;
  actual_gst_cents?: number | null;
  actual_total_cents?: number | null;
  actual_transit_cents?: number | null;
  actual_transit_km?: number | null;

  hourly_rate_customer_cents?: number | null;
  deposit_cents?: number | null;
  /** Referral credit spent on this move (0112). */
  credit_applied_cents?: number | null;
  tip_cents?: number | null;
}

interface ReceiptProfileInput {
  full_name?: string | null;
  email?: string | null;
}

const c = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function bookingToReceiptData(
  booking: ReceiptBookingInput,
  profile: ReceiptProfileInput,
): ReceiptData {
  // A completed move has been billed on real time — that bill is the receipt.
  // Anything else can only be quoted from the estimate.
  const isFinal = booking.actual_total_cents != null;

  const materialsCents = c(booking.materials_cents);
  const fuelCents = c(booking.fuel_cents);
  const rateCents = c(booking.hourly_rate_customer_cents);

  /** cents → the dollars the ReceiptLine type wants. */
  const parts: Array<{ label: string; cents: number }> = [];
  const add = (label: string, cents: number) => {
    if (cents !== 0) parts.push({ label, cents });
  };

  const rateSuffix = rateCents > 0 ? ` @ $${(rateCents / 100).toFixed(0)}/hr` : '';
  const transitLabel = (km: number) =>
    km > 0
      ? `Long-distance transit · ${km.toFixed(1)} km @ $${(TRANSIT_CENTS_PER_KM / 100).toFixed(2)}/km`
      : 'Long-distance transit';

  let subtotalCents: number;
  let gstCents: number;
  let totalCents: number;
  let billedHours: number | undefined;

  if (isFinal) {
    const transitCents = c(booking.actual_transit_cents ?? booking.transit_cents);
    const transitKm = c(booking.actual_transit_km ?? booking.transit_km);
    subtotalCents = c(booking.actual_subtotal_cents);
    gstCents = c(booking.actual_gst_cents);
    totalCents = c(booking.actual_total_cents);
    billedHours = booking.actual_hours != null ? c(booking.actual_hours) : undefined;

    // Move time isn't stored on its own — computeActualBill() persists the
    // subtotal, not its service component. Derive it by subtraction rather
    // than recomputing hours × rate, so the parts always rebuild the subtotal
    // exactly even if a rate was edited after the fact.
    const serviceCents = subtotalCents - materialsCents - fuelCents - transitCents;
    const hoursLabel =
      billedHours != null ? `Move time · ${billedHours.toFixed(2)} hr${rateSuffix}` : 'Move time';

    add(hoursLabel, serviceCents);
    add(transitLabel(transitKm), transitCents);
    add('Materials (boxes, wrap, tape)', materialsCents);
    add('Fuel', fuelCents);
    add('GST (5%)', gstCents);
  } else if (
    booking.service_cost_cents != null ||
    booking.travel_cost_cents != null ||
    booking.materials_cents != null
  ) {
    const transitCents = c(booking.transit_cents);
    const transitKm = c(booking.transit_km);
    gstCents = c(booking.gst_cents ?? booking.price_tax_cents);
    totalCents = c(booking.price_total_cents);
    subtotalCents = booking.price_subtotal_cents != null
      ? c(booking.price_subtotal_cents)
      : c(booking.service_cost_cents) + c(booking.travel_cost_cents) + transitCents +
        materialsCents + fuelCents + c(booking.insurance_cents);
    billedHours =
      booking.total_service_hours != null ? c(booking.total_service_hours) : undefined;

    const hoursLabel =
      billedHours != null ? `Move time · ${billedHours.toFixed(2)} hr${rateSuffix}` : 'Move time';

    add(hoursLabel, c(booking.service_cost_cents));
    add('Travel time (HQ to pickup)', c(booking.travel_cost_cents));
    add(transitLabel(transitKm), transitCents);
    add('Materials (boxes, wrap, tape)', materialsCents);
    add('Fuel', fuelCents);
    add('Moving insurance', c(booking.insurance_cents));
    add('GST (5%)', gstCents);
  } else if (booking.price_subtotal_cents != null) {
    // Legacy rows with no granular columns at all.
    subtotalCents = c(booking.price_subtotal_cents);
    gstCents = c(booking.price_tax_cents);
    totalCents = c(booking.price_total_cents);
    add('Subtotal', subtotalCents);
    add('GST (5%)', gstCents);
  } else {
    subtotalCents = c(booking.price_total_cents);
    gstCents = 0;
    totalCents = c(booking.price_total_cents);
    add('Move total', totalCents);
  }

  // ── Make the column add up, no matter what ───────────────────────────────
  // The engine ceils the total to a whole dollar, so lines + GST usually land
  // a few cents under. Print that instead of leaving an unexplained gap. Any
  // LARGER residual means the stored columns disagree with the stored total —
  // possible on a hand-edited or part-migrated row — so it gets a neutral
  // label rather than being hidden. Either way the receipt reconciles.
  const lineSum = parts.reduce((s, p) => s + p.cents, 0);
  const residual = totalCents - lineSum;
  if (residual !== 0) {
    parts.push({
      label: Math.abs(residual) < 100 ? 'Rounded to nearest dollar' : 'Adjustment',
      cents: residual,
    });
  }

  const lines: ReceiptLine[] = parts.map((p) => ({ label: p.label, amount: p.cents / 100 }));

  const dropoff = booking.dropoff_line1
    ? `${booking.dropoff_line1}${booking.dropoff_city ? ', ' + booking.dropoff_city : ''}`
    : 'In-home (no drop-off)';

  const tipCents = c(booking.tip_cents);
  // Deposit taken at booking against the ESTIMATE; the balance is whatever the
  // real bill came to, less that deposit. Never read balance_due_cents here —
  // it's the estimate-era figure and goes stale the moment actual billing runs.
  const depositCents = Math.min(c(booking.deposit_cents), totalCents);
  // Referral credit spent on this move. Shown as its own line: a customer
  // comparing the total against what their card was charged needs to see where
  // the difference went, or the receipt looks wrong.
  const creditCents = Math.min(c(booking.credit_applied_cents), Math.max(0, totalCents - depositCents));
  const balanceCents = Math.max(0, totalCents - depositCents - creditCents);

  return {
    shortCode: booking.short_code,
    customerName: profile.full_name ?? 'Movvy customer',
    customerEmail: profile.email ?? undefined,
    moveType: booking.move_type.replace(/_/g, ' '),
    scheduledForDate: booking.scheduled_for_date,
    scheduledForWindow: booking.scheduled_for_window ?? undefined,
    completedAt: booking.completed_at ?? new Date().toISOString(),
    pickup: `${booking.pickup_line1}, ${booking.pickup_city}`,
    dropoff,
    billedHours,
    lines,
    tipDollars: tipCents / 100,
    // A receipt records what was PAID. actual_total_cents is the timed bill the
    // customer was actually charged; price_total_cents is only the estimate the
    // deposit was taken against, and on a completed move it's the wrong number
    // to hand someone for their records.
    totalDollars: (totalCents + tipCents) / 100,
    basis: isFinal ? 'actual' : 'estimate',
    depositPaidDollars: depositCents / 100,
    creditAppliedDollars: creditCents / 100,
    balanceDollars: (balanceCents + tipCents) / 100,
  };
}
