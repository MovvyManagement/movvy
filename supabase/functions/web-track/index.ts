// =============================================================================
// POST /web-track
//
// The website's live move page. Nobody needs to be signed in, so this is the
// only thing standing between the internet and a customer's move:
//
//   open      move code + last 4 phone digits  -> signed token + snapshot
//   snapshot  token                            -> latest state (polled)
//   rate      token + stars                    -> the customer's crew rating
//
// Move codes are sequential (MV-1025, MV-1026...), so a code alone proves
// nothing. Both halves are required, failures look identical whether the code
// exists or not, and attempts are limited per IP and per code.
//
// Reading the move and rating it are all a token can do. Changing, cancelling
// and chatting go through the normal signed-in endpoints.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  adminClient,
  audit,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
} from '../_shared/security.ts';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { issueTrackToken, verifyTrackToken } from '../_shared/trackToken.ts';

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('open'),
    code: z.string().trim().min(1).max(20),
    last4: z.string().regex(/^\d{4}$/, 'Enter the last 4 digits of your phone number.'),
  }),
  z.object({
    action: z.literal('snapshot'),
    token: z.string().min(20).max(400),
  }),
  z.object({
    action: z.literal('rate'),
    token: z.string().min(20).max(400),
    overall: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
]);

const NOT_FOUND = "We couldn't find a move with that code and phone number. Check both and try again.";

const LOCATION_STATUSES = ['on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'];
const TIMELINE_STATUSES = ['searching', 'assigned', 'confirmed', ...LOCATION_STATUSES, 'completed'];
const MODIFIABLE_STATUSES = ['pending', 'searching', 'assigned', 'confirmed'];
const CLOSED_STATUSES = ['completed', 'cancelled', 'failed'];
const MIN_MODIFY_HOURS = 24;

const BOOKING_COLUMNS = [
  'id', 'short_code', 'status', 'move_type', 'customer_id',
  'scheduled_for_date', 'scheduled_for_window', 'scheduled_for_window_starts_at',
  'pickup_line1', 'pickup_city', 'pickup_lat', 'pickup_lng',
  'dropoff_line1', 'dropoff_city', 'dropoff_lat', 'dropoff_lng',
  'assigned_company_id', 'assigned_team_id', 'assigned_driver_profile_id',
  'started_at', 'completed_at', 'in_transit_at', 'unloading_at',
  'hourly_rate_customer_cents', 'is_long_haul', 'transit_cents', 'actual_transit_cents',
  'price_total_cents', 'actual_total_cents', 'actual_hours',
  'deposit_cents', 'deposit_status', 'deposit_refunded_cents',
  'payment_status', 'credit_applied_cents', 'customer_notes',
].join(', ');

const VEHICLE_LABELS: Record<string, string> = {
  cargo_van: 'Cargo van',
  cube_van_16: '16 ft cube van',
  box_truck_24: '24 ft box truck',
  box_truck_26: '26 ft box truck',
  pickup_truck: 'Pickup truck',
  other: 'Moving truck',
};

/** The truck that fits this job: the smallest one big enough, else the largest. */
async function truckLabel(admin: SupabaseClient, b: any): Promise<string | null> {
  let query = admin.from('vehicles').select('type, length_ft');
  if (b.assigned_company_id) query = query.eq('company_id', b.assigned_company_id);
  else if (b.assigned_driver_profile_id) query = query.eq('owner_profile_id', b.assigned_driver_profile_id);
  else return null;

  const { data: vehicles } = await query;
  if (!vehicles?.length) return null;

  const { data: required } = await admin.rpc('required_truck_ft', { p_booking_id: b.id });
  const needed = Number(required ?? 0);
  const bySize = [...vehicles].sort((x: any, y: any) => (x.length_ft ?? 0) - (y.length_ft ?? 0));
  const chosen: any = bySize.find((v: any) => (v.length_ft ?? 0) >= needed) ?? bySize[bySize.length - 1];
  return chosen.length_ft ? `${chosen.length_ft} ft moving truck` : VEHICLE_LABELS[chosen.type] ?? 'Moving truck';
}

async function crewFor(admin: SupabaseClient, b: any) {
  if (!b.assigned_company_id && !b.assigned_team_id && !b.assigned_driver_profile_id) return null;

  const org = b.assigned_company_id
    ? (await admin.from('companies')
        .select('display_name, rating_avg, rating_count, verified_at')
        .eq('id', b.assigned_company_id).maybeSingle()).data
    : b.assigned_team_id
    ? (await admin.from('partner_teams')
        .select('display_name, rating_avg, rating_count, verified_at')
        .eq('id', b.assigned_team_id).maybeSingle()).data
    : null;

  const driver = b.assigned_driver_profile_id
    ? (await admin.from('profiles')
        .select('full_name, avatar_url')
        .eq('id', b.assigned_driver_profile_id).maybeSingle()).data
    : null;

  return {
    name: org?.display_name ?? null,
    rating_avg: org?.rating_avg ?? null,
    rating_count: org?.rating_count ?? 0,
    verified: !!org?.verified_at,
    // First name only. The customer needs to recognise them, not more.
    driver_first_name: driver?.full_name?.trim().split(/\s+/)[0] ?? null,
    driver_avatar_url: driver?.avatar_url ?? null,
    truck: await truckLabel(admin, b),
  };
}

async function snapshotFor(admin: SupabaseClient, bookingId: string) {
  const { data, error } = await admin
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) throw httpError(404, NOT_FOUND);
  const b = data as any;

  const [crew, ping, history, rating] = await Promise.all([
    crewFor(admin, b),
    // Location only while a crew is actually out on this job.
    LOCATION_STATUSES.includes(b.status)
      ? admin.from('booking_tracking')
          .select('lat, lng, heading, speed_kph, recorded_at')
          .eq('booking_id', b.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    admin.from('booking_status_history')
      .select('new_status, created_at')
      .eq('booking_id', b.id)
      .order('created_at', { ascending: true })
      .then((r) => r.data ?? []),
    admin.from('ratings')
      .select('id')
      .eq('booking_id', b.id)
      .eq('party', 'customer_to_partner')
      .maybeSingle()
      .then((r) => r.data),
  ]);

  const start = b.scheduled_for_window_starts_at
    ? new Date(b.scheduled_for_window_starts_at)
    : new Date(`${b.scheduled_for_date}T08:00:00Z`);
  const hoursUntil = (start.getTime() - Date.now()) / 3_600_000;

  const depositPaid = b.deposit_status === 'paid';
  const depositApplied = depositPaid
    ? Math.max(0, (b.deposit_cents ?? 0) - (b.deposit_refunded_cents ?? 0))
    : 0;
  const finalBill = b.actual_total_cents ?? null;

  return {
    booking_id: b.id,
    short_code: b.short_code,
    status: b.status,
    move_type: b.move_type,
    date: b.scheduled_for_date,
    window: b.scheduled_for_window,
    pickup: { line1: b.pickup_line1, city: b.pickup_city, lat: b.pickup_lat, lng: b.pickup_lng },
    dropoff: b.dropoff_line1
      ? { line1: b.dropoff_line1, city: b.dropoff_city, lat: b.dropoff_lat, lng: b.dropoff_lng }
      : null,
    notes: b.customer_notes ?? '',
    crew,
    ping,
    timeline: (history as any[])
      .filter((h) => TIMELINE_STATUSES.includes(h.new_status))
      .map((h) => ({ status: h.new_status, at: h.created_at })),
    billing: {
      started_at: b.started_at,
      completed_at: b.completed_at,
      hourly_rate_cents: b.hourly_rate_customer_cents,
      is_long_haul: !!b.is_long_haul,
      transit_cents: b.actual_transit_cents ?? b.transit_cents ?? 0,
      in_transit_at: b.in_transit_at,
      unloading_at: b.unloading_at,
    },
    money: {
      estimate_cents: b.price_total_cents,
      final_cents: finalBill,
      actual_hours: b.actual_hours,
      deposit_cents: depositPaid ? b.deposit_cents : 0,
      deposit_applied_cents: depositApplied,
      credit_applied_cents: b.credit_applied_cents ?? 0,
      paid: b.payment_status === 'captured',
      // Before any referral credit, which the payment step applies and reports.
      due_cents: finalBill != null && b.payment_status !== 'captured'
        ? Math.max(0, finalBill - depositApplied)
        : 0,
    },
    rated: !!rating,
    can: {
      modify: MODIFIABLE_STATUSES.includes(b.status) && hoursUntil >= MIN_MODIFY_HOURS,
      cancel: !CLOSED_STATUSES.includes(b.status) && b.status !== 'draft',
      deposit_refundable: hoursUntil > 48,
    },
  };
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    if (!isAllowedOrigin(req)) throw httpError(403, 'Not allowed');

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const input = parsed.data;
    const admin = adminClient();
    const ip = clientIp(req);

    if (input.action === 'open') {
      // Accept MV-1025, mv1025 or just 1025.
      const digits = input.code.replace(/\D/g, '');
      if (!digits) throw httpError(404, NOT_FOUND);
      const shortCode = `MV-${digits}`;

      // Enough for honest typos and reopening a closed tab, far too few to
      // walk the 10,000 possible endings, even patiently over several days.
      await checkRateLimit({
        bucketKey: `ip:${ip}:web_track_open`,
        endpoint: 'web-track',
        limit: 12,
        windowSeconds: 900,
      });
      await checkRateLimit({
        bucketKey: `code:${shortCode}:web_track_open`,
        endpoint: 'web-track',
        limit: 8,
        windowSeconds: 900,
      });
      await checkRateLimit({
        bucketKey: `code:${shortCode}:web_track_open_day`,
        endpoint: 'web-track',
        limit: 40,
        windowSeconds: 86_400,
      });

      const { data: booking } = await admin
        .from('bookings')
        .select('id, customer_id')
        .eq('short_code', shortCode)
        .maybeSingle();
      if (!booking) throw httpError(404, NOT_FOUND);

      const { data: profile } = await admin
        .from('profiles')
        .select('phone')
        .eq('id', booking.customer_id)
        .maybeSingle();
      const phoneDigits = (profile?.phone ?? '').replace(/\D/g, '');
      if (phoneDigits.length < 4 || phoneDigits.slice(-4) !== input.last4) {
        throw httpError(404, NOT_FOUND);
      }

      await audit({
        actorId: null,
        actorRole: null,
        action: 'booking.web_track_opened',
        entityType: 'booking',
        entityId: booking.id,
        ip,
        ua: req.headers.get('user-agent') ?? undefined,
        payload: {},
      });

      return jsonResponse({
        ok: true,
        token: await issueTrackToken(booking.id),
        snapshot: await snapshotFor(admin, booking.id),
      }, { status: 200 }, cors);
    }

    const bookingId = await verifyTrackToken(input.token);
    if (!bookingId) {
      throw httpError(401, 'This tracking session has expired. Enter your move code again.');
    }

    if (input.action === 'snapshot') {
      // The page refreshes every 5 seconds, so this leaves room for two tabs.
      await checkRateLimit({
        bucketKey: `track:${bookingId}:web_track_snapshot:${ip}`,
        endpoint: 'web-track',
        limit: 40,
        windowSeconds: 60,
      });
      return jsonResponse({ ok: true, snapshot: await snapshotFor(admin, bookingId) }, { status: 200 }, cors);
    }

    // action === 'rate'
    await checkRateLimit({
      bucketKey: `track:${bookingId}:web_track_rate`,
      endpoint: 'web-track',
      limit: 10,
      windowSeconds: 3600,
    });
    const { data: b } = await admin
      .from('bookings')
      .select('id, customer_id, status, assigned_driver_profile_id, assigned_team_id, assigned_company_id')
      .eq('id', bookingId)
      .single();
    if (!b) throw httpError(404, NOT_FOUND);
    if (b.status !== 'completed') throw httpError(400, 'You can rate your crew once the move is complete.');

    const { error: insertErr } = await admin.from('ratings').insert({
      booking_id: b.id,
      party: 'customer_to_partner',
      from_profile_id: b.customer_id,
      to_team_id: b.assigned_team_id ?? null,
      to_company_id: b.assigned_team_id ? null : b.assigned_company_id ?? null,
      to_profile_id: b.assigned_team_id || b.assigned_company_id ? null : b.assigned_driver_profile_id,
      overall: input.overall,
      tags: [],
      comment: input.comment || null,
    });
    // One rating per move. A repeat just lands on the one already saved.
    if (insertErr && insertErr.code !== '23505') {
      console.error('[web-track] rating failed', insertErr);
      throw httpError(500, 'Could not save your rating. Please try again.');
    }
    return jsonResponse({ ok: true }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[web-track] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
