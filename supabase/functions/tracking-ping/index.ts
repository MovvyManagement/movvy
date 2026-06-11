// POST /tracking-ping
// Driver sends their GPS location during an active job. Customer's tracking
// screen subscribes to booking_tracking via Supabase Realtime to see the pin move.
//
// Rate: 1 ping every 5 seconds per driver (720 / hour).

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  heading: z.number().gte(0).lte(360).optional(),
  speed_kph: z.number().gte(0).lte(250).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // ~720 pings/hour. Generous enough for 5-second cadence with retries.
    await checkRateLimit({
      bucketKey: `user:${user.id}:tracking_ping`,
      endpoint: 'tracking-ping',
      limit: 720,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, lat, lng, heading, speed_kph } = parsed.data;

    const supabase = userClient(req.headers.get('Authorization'));
    // RLS policy `bt_insert_driver` ensures only the assigned driver can ping for this booking
    const { error } = await supabase.from('booking_tracking').insert({
      booking_id,
      driver_profile_id: user.id,
      lat,
      lng,
      heading: heading ?? null,
      speed_kph: speed_kph ?? null,
    });
    if (error) throw httpError(403, 'Not authorized to ping for this booking');

    // No audit log on pings — would explode the log table. Tracking history is the trail.

    return jsonResponse({ ok: true }, { status: 202 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[tracking-ping] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
