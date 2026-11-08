// =============================================================================
// POST /web-quote
//
// The price a website visitor sees before they have an account. Runs the same
// server pricing and the same service-area rules as bookings-create, so the
// number shown here is the number the booking comes out at.
//
// Public, so it is limited by IP, restricted to Movvy's own sites, and only
// ever returns customer-facing figures (no crew pay or Movvy margin).
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
} from '../_shared/security.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { closestMajor, computeServerPricing } from '../_shared/pricing.ts';
import { measureRouteLegs } from '../_shared/routeLegs.ts';

const Point = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  city: z.string().max(80).optional(),
});

const Body = z.object({
  pickup: Point,
  dropoff: Point,
  details: z.object({
    moveType: z.enum(['home_move', 'commercial', 'single_items', 'labor_only']),
    dwelling: z.string().max(40).optional(),
    bedrooms: z.number().int().min(0).max(12).optional(),
    crewSize: z.number().int().min(1).max(12).optional(),
    estimatedHours: z.number().min(0).max(24).optional(),
    packingNeeded: z.boolean().optional(),
  }).passthrough(),
});

// The app's calendar never offers anything sooner than this.
const MIN_LEAD_DAYS = 3;

const isInAlberta = (lat: number, lng: number): boolean =>
  lat >= 49.0 && lat <= 60.0 && lng >= -120.0 && lng <= -110.0;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    if (!isAllowedOrigin(req)) throw httpError(403, 'Not allowed');

    const ip = clientIp(req);
    await checkRateLimit({
      bucketKey: `visitor:${ip}:web_quote_min`,
      endpoint: 'web-quote',
      limit: 20,
      windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `visitor:${ip}:web_quote_day`,
      endpoint: 'web-quote',
      limit: 200,
      windowSeconds: 86_400,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { pickup, dropoff, details } = parsed.data;

    if (!isInAlberta(pickup.lat, pickup.lng)) {
      throw httpError(400, 'We currently move only within Alberta. Pickup must be an Alberta address.');
    }
    if (!isInAlberta(dropoff.lat, dropoff.lng)) {
      throw httpError(400, 'We currently move only within Alberta. Drop-off must be an Alberta address.');
    }

    const admin = adminClient();

    // Same order as bookings-create: the pickup's own city if it is active and
    // the address is inside it, otherwise the closest city plus a crew check.
    const slug = (pickup.city ?? '').trim().toLowerCase().replace(/\s+/g, '-') || 'calgary';
    const { data: named } = await admin
      .from('cities')
      .select('id, slug, is_active, bounds_n, bounds_s, bounds_e, bounds_w, booking_lead_days')
      .eq('slug', slug)
      .maybeSingle();

    let leadDays: number | null = null;
    if (
      named?.is_active &&
      pickup.lat <= named.bounds_n && pickup.lat >= named.bounds_s &&
      pickup.lng <= named.bounds_e && pickup.lng >= named.bounds_w
    ) {
      leadDays = named.booking_lead_days;
    } else {
      const { data: closest } = await admin.rpc('find_closest_active_city', {
        p_lat: pickup.lat,
        p_lng: pickup.lng,
      });
      const row = Array.isArray(closest) ? closest[0] : closest;
      if (!row) throw httpError(403, 'No active service area near this address.');

      const { data: covered, error: coverErr } = await admin.rpc('any_crew_covers_pickup', {
        p_lat: pickup.lat,
        p_lng: pickup.lng,
      });
      if (!coverErr && covered !== true) {
        throw httpError(
          403,
          "We don't have a crew covering that address yet. Email support@movvy.ca and we'll tell you as soon as we do.",
        );
      }
      const { data: city } = await admin
        .from('cities')
        .select('booking_lead_days')
        .eq('id', row.id)
        .single();
      leadDays = city?.booking_lead_days ?? null;
    }

    const legs = await measureRouteLegs(admin, closestMajor(pickup), pickup, dropoff);
    const anyDetails = details as Record<string, unknown>;
    const pricing = computeServerPricing({
      pickup,
      dropoff,
      route: legs,
      moveType: details.moveType,
      dwelling: anyDetails.dwelling as any,
      bedrooms: anyDetails.bedrooms as any,
      crewSize: (anyDetails.crewSize ?? anyDetails.hourlyCrewSize ?? anyDetails.helpers) as any,
      estimatedHours: anyDetails.estimatedHours as any,
      packingService: !!anyDetails.packingNeeded,
      movingInsurance: !!anyDetails.movingInsurance,
    });

    // Rounded exactly as bookings-create rounds, to the dollar.
    const totalCents = Math.ceil(pricing.totalCents / 100) * 100;
    const depositCents = Math.ceil((totalCents * 0.20) / 100) * 100;

    const minDate = new Date();
    minDate.setUTCHours(0, 0, 0, 0);
    minDate.setUTCDate(minDate.getUTCDate() + Math.max(MIN_LEAD_DAYS, leadDays ?? 0));

    return jsonResponse({
      ok: true,
      min_date: minDate.toISOString().slice(0, 10),
      quote: {
        total_cents: totalCents,
        deposit_cents: depositCents,
        balance_cents: Math.max(0, totalCents - depositCents),
        subtotal_cents: pricing.taxableSubtotalCents,
        hourly_rate_cents: pricing.hourlyRateCustomerCents,
        crew: pricing.recommendedCrew,
        trucks: pricing.trucksIncluded,
        on_site_hours: pricing.billableOnSiteHours,
        total_hours: pricing.totalServiceHours,
        minimum_applied: pricing.minimumApplied,
        service_cents: pricing.serviceCostCents,
        travel_cents: pricing.travelCostCents + pricing.transportCostCents,
        transit_cents: pricing.transitCents,
        fuel_cents: pricing.longHaulCustomerCents,
        materials_cents: pricing.materialsCents,
        gst_cents: pricing.gstCents,
        is_long_haul: pricing.isLongHaul,
      },
    }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[web-quote] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
