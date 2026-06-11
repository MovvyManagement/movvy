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

    // Load + ownership + status + cutoff check
    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select('id, customer_id, status, scheduled_for_date, scheduled_for_window_starts_at')
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

    const { data, error: uErr } = await admin
      .from('bookings')
      .update(patch)
      .eq('id', input.booking_id)
      .eq('customer_id', user.id)
      .in('status', MODIFIABLE_STATUSES as any)
      .select('id, short_code, status, scheduled_for_date, scheduled_for_window')
      .single();
    if (uErr || !data) throw httpError(500, 'Could not save changes — try again.');

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.modified',
      entityType: 'booking',
      entityId: input.booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { patched_keys: Object.keys(patch) },
    });

    return jsonResponse({ ok: true, booking: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-modify] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
