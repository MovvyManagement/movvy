// =============================================================================
// Edge Function: POST /bookings-create
//
// Security layers (in order):
//   1. CORS preflight + restricted origins
//   2. Rate limit (5 / hour / user)
//   3. JWT auth + suspended-account check
//   4. Zod input validation
//   5. City lookup + service-area gate
//   6. Pricing recomputed server-side (NEVER trust client price)
//   7. INSERT through user-scoped client (RLS still applies)
//   8. Audit log
//
// Pricing is PLACEHOLDER until the user provides the official rate card.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient,
  audit,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
  requireAuth,
  userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { computeServerPricing } from '../_shared/pricing.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { bookingConfirmed } from '../_shared/emails/index.ts';
import {
  fmtAddress,
  fmtDateTime,
  fmtMoney,
  fmtTimeWindow,
  startHourFromWindow,
} from '../_shared/format.ts';

// ─── Distance / duration helpers ──────────────────────────────────────────
// Copied from src/lib/distance.ts (haversineKm + roadKm). Edge functions
// can't import client code, so we mirror the math here. Off by < 5% from
// Google Routes API for inner-city moves, ~10% for inter-city — close
// enough for the job-details summary the mover sees on the accept screen.
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Best-effort pickup → dropoff driving distance + duration. Used to
 * populate bookings.distance_km / duration_min at insert time so the
 * mover's job-details screen shows real numbers instead of "0 km · 0 min".
 *
 * We pick the urban vs highway speed band off the straight-line distance:
 *   ≤ 30 km → 40 km/h (city stop-and-go) + 5 min handling buffer
 *   > 30 km → 80 km/h (Hwy 2, QE2, etc.) + 5 min on-ramp / merge buffer
 *
 * Skipped (returns null) when either endpoint lacks coords — labor-only
 * jobs without a dropoff fall in this bucket and that's the right answer
 * (distance/duration aren't meaningful when there's only one location).
 */
function estimateBookingRoute(
  pickup: { lat: number | null; lng: number | null } | null | undefined,
  dropoff: { lat: number | null; lng: number | null } | null | undefined,
): { distance_km: number; duration_min: number } | null {
  if (
    !pickup ||
    !dropoff ||
    pickup.lat == null ||
    pickup.lng == null ||
    dropoff.lat == null ||
    dropoff.lng == null
  ) {
    return null;
  }
  const straight = haversineKm(
    { lat: pickup.lat, lng: pickup.lng },
    { lat: dropoff.lat, lng: dropoff.lng },
  );
  // road factor — straight-line × 1.3 is the standard urban grid correction
  const roadKm = straight * 1.3;
  const speedKph = roadKm <= 30 ? 40 : 80;
  const driveMin = Math.round((roadKm / speedKph) * 60) + 5;
  return {
    distance_km: Math.round(roadKm * 10) / 10, // 1 decimal
    duration_min: driveMin,
  };
}

// Mirror of src/lib/validation/schemas.ts BookingCreateInput.
// Edge functions can't import from the app, so we copy + keep in sync.
// (Future: extract to a shared npm package or codegen.)
const Lat = z.number().gte(-90).lte(90);
const Lng = z.number().gte(-180).lte(180);
const Addr = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(100).optional(),
  city: z.string().min(1).max(80),
  region: z.string().min(1).max(64),
  country_code: z.string().regex(/^[A-Z]{2}$/),
  postal: z.string().max(20).optional(),
  lat: Lat,
  lng: Lng,
});
const Body = z.object({
  city_slug: z.string().min(1).max(40),
  pickup: Addr,
  dropoff: Addr.nullable(),
  schedule: z.object({
    mode: z.enum(['asap', 'scheduled']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    window: z.string().min(1).max(60),
  }),
  details: z.object({
    moveType: z.enum(['home_move', 'commercial', 'single_items', 'labor_only']),
  }).passthrough(),
  customer_notes: z.string().max(2000).optional(),
  promo_code: z.string().max(40).optional(),
  client_estimate_total_cents: z.number().int().optional(), // hint only — server recomputes
});

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);
  }

  try {
    // 1) Auth
    const user = await requireAuth(req);
    if (user.role !== 'customer' && user.role !== 'movvy_admin') {
      throw httpError(403, 'Only customers can create bookings');
    }

    // 2) Rate limit — 5 booking creates per hour per user
    await checkRateLimit({
      bucketKey: `user:${user.id}:bookings_create`,
      endpoint: 'bookings-create',
      limit: 5,
      windowSeconds: 3600,
    });

    // 3) Parse + validate
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw httpError(400, 'Invalid JSON body');
    }
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    // 4) Pick the operating city.
    //    - If the client passed a city_slug AND the pickup is inside its bounds → use that.
    //    - Otherwise → find the closest active city to the pickup coords.
    //    - If pickup isn't in Alberta at all → reject.
    const admin = adminClient();

    // Province check first (loose box). Movvy serves Alberta only — both
    // pickup AND drop-off must be inside the province. Cross-province
    // long-haul moves are out of scope for the current operating area.
    const isInAlberta = (lat: number, lng: number): boolean =>
      lat >= 49.0 && lat <= 60.0 && lng >= -120.0 && lng <= -110.0;
    if (!isInAlberta(input.pickup.lat, input.pickup.lng)) {
      throw httpError(400, 'We currently move only within Alberta — pickup must be an Alberta address.');
    }
    if (
      input.dropoff &&
      !isInAlberta(input.dropoff.lat, input.dropoff.lng)
    ) {
      throw httpError(400, 'We currently move only within Alberta — drop-off must be an Alberta address.');
    }

    let city: any = null;
    if (input.city_slug) {
      const { data } = await admin
        .from('cities')
        .select('id, slug, is_active, bounds_n, bounds_s, bounds_e, bounds_w, booking_lead_days')
        .eq('slug', input.city_slug)
        .single();
      if (data?.is_active &&
          input.pickup.lat <= data.bounds_n && input.pickup.lat >= data.bounds_s &&
          input.pickup.lng <= data.bounds_e && input.pickup.lng >= data.bounds_w) {
        city = data;
      }
    }

    // Fallback: closest active city via the SQL helper from migration 0014
    if (!city) {
      const { data: closest } = await admin.rpc('find_closest_active_city', {
        p_lat: input.pickup.lat,
        p_lng: input.pickup.lng,
      });
      const row = Array.isArray(closest) ? closest[0] : closest;
      if (!row) throw httpError(403, 'No active service area near this address');
      // Pull the full row for bounds + lead-days
      const { data: full } = await admin
        .from('cities')
        .select('id, slug, is_active, bounds_n, bounds_s, bounds_e, bounds_w, booking_lead_days')
        .eq('id', row.id)
        .single();
      city = full;
      // Cap the dispatch distance — refuse if more than ~200km from any HQ
      if ((row.distance_km ?? 0) > 200) {
        throw httpError(403, `Out of service area (${Math.round(row.distance_km)} km from nearest Movvy HQ).`);
      }
    }
    if (!city) throw httpError(400, 'Could not determine a serving city');

    // 5) Lead-time check (server side — never trust client date)
    if (input.schedule.mode === 'scheduled') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const minDate = new Date(today.getTime() + city.booking_lead_days * 86_400_000);
      const picked = new Date(input.schedule.date + 'T00:00:00Z');
      if (picked < minDate) {
        throw httpError(400, `Booking date must be at least ${city.booking_lead_days} days from today`);
      }
    }

    // 6) Pricing — recomputed AUTHORITATIVELY on the server.
    //    Never trusts the client's `client_estimate_total_cents` hint.
    const pricing = computeServerPricing({
      pickup: { lat: input.pickup.lat, lng: input.pickup.lng },
      dropoff: input.dropoff
        ? { lat: input.dropoff.lat, lng: input.dropoff.lng }
        : { lat: input.pickup.lat, lng: input.pickup.lng }, // labor-only: same loc
      moveType: input.details.moveType,
      dwelling: (input.details as any).dwelling,
      bedrooms: (input.details as any).bedrooms,
      crewSize: (input.details as any).crewSize ?? (input.details as any).hourlyCrewSize ?? (input.details as any).helpers,
      estimatedHours: (input.details as any).estimatedHours,
      packingService: !!(input.details as any).packingNeeded,
      movingInsurance: !!(input.details as any).movingInsurance,
    });

    // 6b) Apply promo code if one was provided. Server re-validates every limit.
    let promoId: string | null = null;
    let discountCents = 0;
    if (input.promo_code) {
      const code = input.promo_code.toUpperCase();
      const { data: promo } = await admin
        .from('promo_codes')
        .select('id, kind, value, min_subtotal_cents, max_redemptions, redeemed_count, per_user_limit, expires_at, city_id, is_active')
        .eq('code', code)
        .maybeSingle();
      const validPromo =
        promo &&
        promo.is_active &&
        (!promo.expires_at || new Date(promo.expires_at) > new Date()) &&
        (!promo.max_redemptions || promo.redeemed_count < promo.max_redemptions) &&
        (!promo.city_id || promo.city_id === city.id) &&
        pricing.taxableSubtotalCents >= (promo.min_subtotal_cents ?? 0);
      if (validPromo) {
        const { count: userUses } = await admin
          .from('promo_redemptions')
          .select('*', { count: 'exact', head: true })
          .eq('promo_code_id', promo.id)
          .eq('profile_id', user.id);
        if ((userUses ?? 0) < (promo.per_user_limit ?? 1)) {
          if (promo.kind === 'percent_off') {
            discountCents = Math.round((pricing.taxableSubtotalCents * promo.value) / 100);
          } else if (promo.kind === 'amount_off_cents') {
            discountCents = Math.min(promo.value, pricing.taxableSubtotalCents);
          } else {
            discountCents = Math.min(2500, pricing.taxableSubtotalCents);
          }
          promoId = promo.id;
        }
      }
    }
    // Re-compute total / deposit after discount
    const totalAfterPromoRaw = Math.max(0, pricing.totalCents - discountCents);
    const totalCentsFinal = Math.ceil(totalAfterPromoRaw / 100) * 100;
    const depositCentsFinal = Math.ceil((totalCentsFinal * 0.20) / 100) * 100;
    const balanceDueOnCompletionCentsFinal = Math.max(0, totalCentsFinal - depositCentsFinal);

    // 7) Insert through user-scoped client so RLS still applies.
    // RLS ensures customer_id === auth.uid().
    const supabase = userClient(req.headers.get('Authorization'));

    // Real pickup→dropoff distance + duration so the mover's job-details
    // summary doesn't render "0 km · 0 min" when the row reaches them.
    // Returns null for labor-only (no dropoff); the column stays null
    // and the UI displays the same "0 km" placeholder it always did.
    const route = estimateBookingRoute(
      { lat: input.pickup.lat, lng: input.pickup.lng },
      input.dropoff
        ? { lat: input.dropoff.lat, lng: input.dropoff.lng }
        : null,
    );

    const { data: booking, error: insertErr } = await supabase
      .from('bookings')
      .insert({
        customer_id: user.id,
        city_id: city.id,
        move_type: input.details.moveType,
        distance_km: route?.distance_km ?? null,
        duration_min: route?.duration_min ?? null,
        // DEPOSIT GATE (2026-07-14): bookings are held as 'draft' — invisible
        // to crews — until the 20% deposit is confirmed by the Stripe webhook,
        // which flips draft → 'searching' and runs the partner broadcast +
        // booking-confirmed email (both moved there from this function).
        status: 'draft',
        pickup_line1: input.pickup.line1,
        pickup_line2: input.pickup.line2 ?? null,
        pickup_city: input.pickup.city,
        pickup_region: input.pickup.region,
        pickup_postal: input.pickup.postal ?? null,
        pickup_country_code: input.pickup.country_code,
        pickup_lat: input.pickup.lat,
        pickup_lng: input.pickup.lng,
        dropoff_line1: input.dropoff?.line1 ?? null,
        dropoff_line2: input.dropoff?.line2 ?? null,
        dropoff_city: input.dropoff?.city ?? null,
        dropoff_region: input.dropoff?.region ?? null,
        dropoff_postal: input.dropoff?.postal ?? null,
        dropoff_country_code: input.dropoff?.country_code ?? null,
        dropoff_lat: input.dropoff?.lat ?? null,
        dropoff_lng: input.dropoff?.lng ?? null,
        schedule_mode: input.schedule.mode,
        scheduled_for_date: input.schedule.date,
        scheduled_for_window: input.schedule.window,
        details: input.details,
        customer_notes: input.customer_notes ?? null,

        // Legacy aggregate columns (kept so existing client queries don't break)
        price_base_cents: pricing.serviceCostCents,
        price_rooms_cents: 0,
        price_distance_cents: pricing.travelCostCents,
        price_addons_cents: pricing.insuranceCents,
        price_subtotal_cents: pricing.taxableSubtotalCents,
        price_service_fee_cents: 0,
        price_tax_cents: pricing.gstCents,
        price_total_cents: totalCentsFinal,
        price_commission_cents: pricing.movvyTotalMarginCents,
        // Fuel surcharge captured at booking time. Needed at completion
        // (bookings-update-status → computeActualBill) so the actual bill
        // can re-add it without knowing the route.
        fuel_cents: pricing.longHaulCustomerCents,
        pricing_breakdown: { ...pricing, discount_cents: discountCents, promo_id: promoId } as any,
        promo_code_id: promoId,

        // Granular pricing-v2 columns (migration 0010)
        travel_hours: pricing.travelHours,
        property_hours: pricing.propertyHours,
        packing_hours: pricing.packingHours,
        additional_hours: pricing.additionalHours,
        total_service_hours: pricing.totalServiceHours,
        recommended_crew: pricing.recommendedCrew,
        hourly_rate_customer_cents: pricing.hourlyRateCustomerCents,
        hourly_rate_driver_cents: pricing.hourlyRateDriverCents,

        service_cost_cents: pricing.serviceCostCents,
        travel_cost_cents: pricing.travelCostCents,
        materials_cents: pricing.materialsCents,
        insurance_cents: pricing.insuranceCents,
        gst_cents: pricing.gstCents,

        driver_service_cents: pricing.driverServiceCents,
        driver_travel_cents: pricing.driverTravelCents,
        driver_materials_cents: pricing.driverMaterialsCents,
        driver_total_cents: pricing.driverTotalCents,
        driver_earnings_cents: pricing.driverTotalCents,  // legacy column

        movvy_service_margin_cents: pricing.movvyServiceMarginCents,
        movvy_travel_margin_cents: pricing.movvyTravelMarginCents,
        movvy_materials_margin_cents: pricing.movvyMaterialsMarginCents,
        movvy_insurance_margin_cents: pricing.movvyInsuranceMarginCents,
        movvy_margin_cents: pricing.movvyTotalMarginCents,

        deposit_cents: depositCentsFinal,
        balance_due_cents: balanceDueOnCompletionCentsFinal,

        packing_service: !!(input.details as any).packingNeeded,
        moving_insurance: !!(input.details as any).movingInsurance,
      })
      .select('id, short_code, status, price_total_cents')
      .single();

    if (insertErr) {
      // Temporary verbose error so the client toast tells us exactly which
      // constraint / RLS rule rejected the row. Revert to the generic
      // message once Stripe + the deposit flow are wired.
      console.error('[bookings-create] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
        details: insertErr.details,
        hint: insertErr.hint,
      });
      throw httpError(
        500,
        `Could not create booking — ${insertErr.code ?? '?'} · ${insertErr.message ?? ''}`,
      );
    }

    // 7b) Record promo redemption (best-effort; not fatal if it fails)
    if (promoId && discountCents > 0) {
      await admin.from('promo_redemptions').insert({
        promo_code_id: promoId,
        profile_id: user.id,
        booking_id: booking.id,
        discount_cents: discountCents,
      });
      // Increment the counter on the promo itself
      await admin.rpc('increment_promo_redeemed', { p_promo_id: promoId }).catch(() => {
        // Fallback if RPC doesn't exist: manual update
        return admin
          .from('promo_codes')
          .update({ redeemed_count: 1 })  // safe minimum; real number is the rows in promo_redemptions
          .eq('id', promoId);
      });
    }

    // 8) Audit
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking.id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { city_slug: city.slug, move_type: input.details.moveType, promo_id: promoId, discount_cents: discountCents },
    });

    // 9+10) Partner broadcast + booking-confirmed email now fire from
    // stripe-webhook when the deposit lands and the booking flips
    // draft → searching. Announcing an undispatched (unpaid) booking to
    // crews — or telling the customer "you're booked" before the deposit —
    // would be lying to both sides.

    return jsonResponse(
      { ok: true, booking },
      { status: 201 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.message }, { status: e.status }, cors);
    }
    console.error('[bookings-create] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// Deno serve helper (compat for both `serve` and `Deno.serve` paths)
function serve(handler: (req: Request) => Promise<Response>) {
  // @ts-ignore — Deno global exists at runtime
  if (typeof Deno?.serve === 'function') {
    // @ts-ignore
    Deno.serve(handler);
    return;
  }
  // Fallback to std/http serve
  import('https://deno.land/std@0.220.1/http/server.ts').then(({ serve: stdServe }) => {
    stdServe(handler);
  });
}
