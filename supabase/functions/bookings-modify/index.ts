// =============================================================================
// POST /bookings-modify
//
// Customer modifies an upcoming booking — change date/window, pickup/dropoff
// addresses, or move details. Deposit is NON-REFUNDABLE and stays as-is.
//
// Rules:
//   • Booking must belong to the calling customer
//   • Status must be pending / searching / assigned / confirmed
//     (i.e. NOT in-flight on_the_way → unloading, and NOT completed/cancelled)
//   • Cutoff: scheduled_for_date must be ≥ 24h from now
//
// What can change:
//   • scheduled_for_date  + scheduled_for_window
//   • pickup_*  (line1/city/region/lat/lng)
//   • dropoff_* (same)
//   • details JSON (move type, bedrooms, dwelling, etc — re-prices)
//   • customer_notes
//
// What CANNOT change: customer_id, total/deposit (deposit non-refundable),
// move_type (would invalidate the pricing class), city_id.
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
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { computeServerPricing, closestMajor } from '../_shared/pricing.ts';
import { measureRouteLegs } from '../_shared/routeLegs.ts';

// Movvy serves Alberta only — same loose box bookings-create enforces. This
// endpoint had NO province check at all, so a customer could book a legal
// Calgary move and then modify the pickup to Vancouver.
const isInAlberta = (lat: number, lng: number): boolean =>
  lat >= 49.0 && lat <= 60.0 && lng >= -120.0 && lng <= -110.0;

const PhoneSafe = z.string().min(1).max(200);
const Addr = z.object({
  line1: PhoneSafe,
  city: PhoneSafe,
  region: z.string().min(1).max(64),
  country_code: z.string().length(2),
  postal: z.string().max(20).optional().nullable(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const Body = z.object({
  booking_id: z.string().uuid(),
  scheduled_for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduled_for_window: z.string().max(60).optional(),
  pickup: Addr.optional(),
  dropoff: Addr.nullable().optional(),
  details: z.record(z.string(), z.any()).optional(),
  customer_notes: z.string().max(2000).optional(),
});

const MODIFIABLE_STATUSES = ['pending', 'searching', 'assigned', 'confirmed'];
const MIN_LEAD_HOURS = 24;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:bookings_modify`,
      endpoint: 'bookings-modify',
      limit: 20,
      windowSeconds: 600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const input = parsed.data;

    const admin = adminClient();

    // Province check BEFORE anything else. This endpoint had none, while
    // bookings-create enforces it on both addresses.
    if (input.pickup && !isInAlberta(input.pickup.lat, input.pickup.lng)) {
      throw httpError(400, 'We currently move only within Alberta — pickup must be an Alberta address.');
    }
    if (input.dropoff && !isInAlberta(input.dropoff.lat, input.dropoff.lng)) {
      throw httpError(400, 'We currently move only within Alberta — drop-off must be an Alberta address.');
    }

    // Load + ownership + status + cutoff check. Pull every pricing input too:
    // a modification re-prices, and the fields the caller DIDN'T send still
    // feed the engine.
    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select(
        'id, short_code, customer_id, status, scheduled_for_date, scheduled_for_window_starts_at, ' +
        'details, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, ' +
        'deposit_cents, price_total_cents, ' +
        // Who is on the hook for this move — they have to be told when the job
        // they accepted changes underneath them.
        'assigned_company_id, assigned_driver_profile_id, pickup_city, dropoff_city',
      )
      .eq('id', input.booking_id)
      .maybeSingle();
    if (bErr || !booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, 'Not your booking');
    if (!MODIFIABLE_STATUSES.includes(booking.status)) {
      throw httpError(409, "This booking can no longer be modified — it's already in progress or finished.");
    }

    // 24h cutoff — use the precise window-start timestamp if set, otherwise
    // fall back to scheduled_for_date at midnight local (Calgary).
    const startTime = booking.scheduled_for_window_starts_at
      ? new Date(booking.scheduled_for_window_starts_at).getTime()
      : new Date(`${booking.scheduled_for_date}T00:00:00-07:00`).getTime();
    const msUntilMove = startTime - Date.now();
    if (msUntilMove < MIN_LEAD_HOURS * 60 * 60 * 1000) {
      throw httpError(
        403,
        "Move is less than 24 hours away — can't modify online. Contact support for help.",
      );
    }

    // Build the patch — only include fields the caller actually sent
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.scheduled_for_date) patch.scheduled_for_date = input.scheduled_for_date;
    if (input.scheduled_for_window) patch.scheduled_for_window = input.scheduled_for_window;
    if (input.customer_notes !== undefined) patch.customer_notes = input.customer_notes;
    if (input.details) patch.details = input.details;
    if (input.pickup) {
      patch.pickup_line1 = input.pickup.line1;
      patch.pickup_city = input.pickup.city;
      patch.pickup_region = input.pickup.region;
      patch.pickup_country_code = input.pickup.country_code;
      patch.pickup_postal = input.pickup.postal ?? null;
      patch.pickup_lat = input.pickup.lat;
      patch.pickup_lng = input.pickup.lng;
    }
    if (input.dropoff !== undefined) {
      if (input.dropoff === null) {
        patch.dropoff_line1 = null;
        patch.dropoff_city = null;
        patch.dropoff_region = null;
        patch.dropoff_country_code = null;
        patch.dropoff_postal = null;
        patch.dropoff_lat = null;
        patch.dropoff_lng = null;
      } else {
        patch.dropoff_line1 = input.dropoff.line1;
        patch.dropoff_city = input.dropoff.city;
        patch.dropoff_region = input.dropoff.region;
        patch.dropoff_country_code = input.dropoff.country_code;
        patch.dropoff_postal = input.dropoff.postal ?? null;
        patch.dropoff_lat = input.dropoff.lat;
        patch.dropoff_lng = input.dropoff.lng;
      }
    }

    // ── RE-PRICE ────────────────────────────────────────────────────────────
    // The header has always claimed this endpoint "re-prices". It never did:
    // it rewrote the coordinates and the details JSON and left every pricing
    // column frozen at the original quote. Because computeActualBill reads
    // those same frozen columns at completion, the stale price flowed all the
    // way into the final invoice. Moving a Calgary→Calgary 3-bed's drop-off to
    // Edmonton (365 km) kept a $2,586 price on a $4,067 move — $1,481 unbilled,
    // and the crew drove to Edmonton for Calgary money.
    //
    // Re-priced through the SAME engine and the SAME measured route as a fresh
    // booking, so a modified move is priced by identical metrics to one booked
    // from scratch. Anything the caller didn't send falls back to the stored
    // value, so changing only the date doesn't silently re-quote off defaults.
    const nextDetails = { ...(booking.details ?? {}), ...(input.details ?? {}) } as any;
    const pickupCoord = input.pickup
      ? { lat: input.pickup.lat, lng: input.pickup.lng }
      : { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) };
    const dropoffCoord = input.dropoff !== undefined
      ? (input.dropoff ? { lat: input.dropoff.lat, lng: input.dropoff.lng } : pickupCoord)
      : (booking.dropoff_lat != null
          ? { lat: Number(booking.dropoff_lat), lng: Number(booking.dropoff_lng) }
          : pickupCoord);

    const routeLegs = await measureRouteLegs(
      admin,
      closestMajor(pickupCoord),
      pickupCoord,
      dropoffCoord,
      user.id,
    );

    const pricing = computeServerPricing({
      pickup: pickupCoord,
      dropoff: dropoffCoord,
      route: routeLegs,
      moveType: nextDetails.moveType,
      dwelling: nextDetails.dwelling,
      bedrooms: nextDetails.bedrooms,
      crewSize: nextDetails.crewSize ?? nextDetails.hourlyCrewSize ?? nextDetails.helpers,
      estimatedHours: nextDetails.estimatedHours,
      packingService: !!nextDetails.packingNeeded,
      movingInsurance: !!nextDetails.movingInsurance,
    });

    // The deposit is non-refundable and already charged, so it does NOT move.
    // Only the total and the balance still owed change. Clamp the balance at 0
    // so a customer who downsizes below their deposit is never shown a
    // negative amount due — that difference is handled as a refund by hand.
    const depositPaid = Number(booking.deposit_cents ?? 0);
    patch.price_base_cents = pricing.serviceCostCents;
    patch.price_distance_cents = pricing.travelCostCents;
    patch.price_addons_cents = pricing.insuranceCents;
    patch.price_subtotal_cents = pricing.taxableSubtotalCents;
    patch.price_tax_cents = pricing.gstCents;
    patch.price_total_cents = pricing.totalCents;
    patch.price_commission_cents = pricing.movvyTotalMarginCents;
    patch.service_cost_cents = pricing.serviceCostCents;
    patch.travel_cost_cents = pricing.travelCostCents;
    patch.materials_cents = pricing.materialsCents;
    patch.insurance_cents = pricing.insuranceCents;
    patch.gst_cents = pricing.gstCents;
    patch.fuel_cents = pricing.longHaulCustomerCents;
    patch.transit_cents = pricing.transitCents;
    patch.transit_km = pricing.transportKm;
    patch.is_long_haul = pricing.isLongHaul;
    patch.hourly_rate_customer_cents = pricing.hourlyRateCustomerCents;
    patch.hourly_rate_driver_cents = pricing.hourlyRateDriverCents;
    patch.property_hours = pricing.propertyHours;
    patch.travel_hours = pricing.travelHours;
    patch.total_service_hours = pricing.totalServiceHours;
    patch.distance_km = routeLegs.pickupToDropoffKm;
    patch.balance_due_cents = Math.max(0, pricing.totalCents - depositPaid);
    patch.driver_earnings_cents = pricing.driverTotalCents;
    patch.driver_total_cents = pricing.driverTotalCents;
    patch.movvy_margin_cents = pricing.movvyTotalMarginCents;
    if (input.details) patch.details = nextDetails;

    const { data, error: uErr } = await admin
      .from('bookings')
      .update(patch)
      .eq('id', input.booking_id)
      .eq('customer_id', user.id)
      .in('status', MODIFIABLE_STATUSES as any)
      .select('id, short_code, status, scheduled_for_date, scheduled_for_window, price_total_cents, deposit_cents, balance_due_cents')
      .single();
    if (uErr || !data) throw httpError(500, 'Could not save changes — try again.');

    // ── Tell the crew their job changed ─────────────────────────────────────
    // If a crew has already taken this move, it is no longer just the
    // customer's booking — someone has planned a day around it. A silent change
    // meant a crew could accept a $2,586 Calgary→Calgary job, have the customer
    // move the drop-off to Edmonton, and discover a $4,067 long haul on the
    // morning. Worse, the new address may be outside their service radius or
    // need a bigger truck, in which case they need to act, not be surprised.
    //
    // Fire-and-forget: a notification failure must never undo a saved change.
    // Goes to the assigned performer AND the org's admins — the admin owns the
    // decision to keep or release it, the performer is the one driving.
    if (booking.assigned_company_id || booking.assigned_driver_profile_id) {
      try {
        const priceBefore = Number(booking.price_total_cents ?? 0);
        const priceAfter = Number(data.price_total_cents ?? 0);
        const delta = priceAfter - priceBefore;
        const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;

        const changed: string[] = [];
        if (input.pickup) changed.push('pickup address');
        if (input.dropoff !== undefined) changed.push('drop-off address');
        if (input.scheduled_for_date) changed.push('date');
        if (input.scheduled_for_window) changed.push('arrival window');
        if (input.details) changed.push('move details');
        const what = changed.length ? changed.join(', ') : 'booking details';

        const priceLine =
          delta === 0
            ? 'The price is unchanged.'
            : `The estimate ${delta > 0 ? 'went up' : 'went down'} by ${money(delta)} to ${money(priceAfter)}.`;

        // Recipients: the performer, plus every active admin of the org.
        const ids = new Set<string>();
        if (booking.assigned_driver_profile_id) ids.add(booking.assigned_driver_profile_id);
        if (booking.assigned_company_id) {
          const { data: admins } = await admin
            .from('company_members')
            .select('profile_id')
            .eq('company_id', booking.assigned_company_id)
            .eq('org_role', 'admin')
            .eq('status', 'active')
            .is('removed_at', null);
          for (const a of admins ?? []) if (a.profile_id) ids.add(a.profile_id);
        }

        if (ids.size > 0) {
          const rows = [...ids].map((profile_id) => ({
            profile_id,
            channel: 'in_app' as const,
            category: 'booking.modified',
            title: `Move ${booking.short_code} changed`,
            body:
              `The customer updated the ${what}. ${priceLine} ` +
              `Check the new route still works for your crew and truck.`,
            data: {
              booking_id: input.booking_id,
              short_code: booking.short_code,
              changed,
              price_before_cents: priceBefore,
              price_after_cents: priceAfter,
            },
          }));
          const { error: nErr } = await admin.from('notifications').insert(rows);
          // supabase-js RETURNS errors rather than throwing, so this would have
          // been swallowed by the try/catch alone.
          if (nErr) console.error('[bookings-modify] crew notify failed', nErr);
        }
      } catch (nErr) {
        console.warn('[bookings-modify] crew notify failed (non-fatal)', nErr);
      }
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.modified',
      entityType: 'booking',
      entityId: input.booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: {
        patched_keys: Object.keys(patch),
        price_before_cents: Number(booking.price_total_cents ?? 0),
        price_after_cents: Number(data.price_total_cents ?? 0),
        was_assigned: !!(booking.assigned_company_id || booking.assigned_driver_profile_id),
      },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-modify] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
