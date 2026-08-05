// =============================================================================
// Booking row → ReceiptData adapter
//
// One place to translate a DbBooking (plus the customer's profile) into the
// shape our HTML receipt + PDF + (legacy) email receipt all consume. Keeps
// the receipt screen UI dumb: pass a booking, get a printable PDF.
// =============================================================================

import type { ReceiptData, ReceiptLine } from './receipt';

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
  /** Granular pricing — preferred when present. */
  service_cost_cents?: number | null;
  travel_cost_cents?: number | null;
  materials_cents?: number | null;
  insurance_cents?: number | null;
  gst_cents?: number | null;
  /** Aggregate fallback for older bookings. */
  price_subtotal_cents?: number | null;
  price_tax_cents?: number | null;
  price_total_cents: number;
  tip_cents?: number | null;
}

interface ReceiptProfileInput {
  full_name?: string | null;
  email?: string | null;
}

export function bookingToReceiptData(
  booking: ReceiptBookingInput,
  profile: ReceiptProfileInput,
): ReceiptData {
  const lines: ReceiptLine[] = [];

  // Granular path — every line shown explicitly.
  if (
    booking.service_cost_cents != null ||
    booking.travel_cost_cents != null ||
    booking.materials_cents != null
  ) {
    if (booking.service_cost_cents)
      lines.push({ label: 'Move time', amount: booking.service_cost_cents / 100 });
    if (booking.travel_cost_cents)
      lines.push({ label: 'Travel time', amount: booking.travel_cost_cents / 100 });
    if (booking.materials_cents)
      lines.push({ label: 'Materials (boxes, wrap, tape)', amount: booking.materials_cents / 100 });
    if (booking.insurance_cents)
      lines.push({ label: 'Moving insurance', amount: booking.insurance_cents / 100 });
    if (booking.gst_cents)
      lines.push({ label: 'GST (5%)', amount: booking.gst_cents / 100 });
  } else if (booking.price_subtotal_cents != null) {
    // Aggregate fallback for legacy bookings without granular columns.
    lines.push({ label: 'Subtotal', amount: (booking.price_subtotal_cents ?? 0) / 100 });
    lines.push({ label: 'Tax (GST 5%)', amount: (booking.price_tax_cents ?? 0) / 100 });
  } else {
    lines.push({ label: 'Move total', amount: booking.price_total_cents / 100 });
  }

  const dropoff = booking.dropoff_line1
    ? `${booking.dropoff_line1}${booking.dropoff_city ? ', ' + booking.dropoff_city : ''}`
    : 'In-home (no drop-off)';

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
    lines,
    tipDollars: (booking.tip_cents ?? 0) / 100,
    // A receipt records what was PAID. actual_total_cents is the timed bill
    // the customer was actually charged; price_total_cents is only the estimate
    // the deposit was taken against, and on a completed move it's the wrong
    // number to hand someone for their records.
    totalDollars:
      (((booking as any).actual_total_cents ?? booking.price_total_cents) +
        (booking.tip_cents ?? 0)) / 100,
  };
}
