// POST /proxy-session-create
// Creates a Twilio Proxy session pairing the customer + driver of a booking.
// Both sides see the same temporary Twilio number; Twilio routes to real numbers.
//
// STUB: Currently returns "twilio_not_configured" with a helpful message.
// When Twilio is wired up, this function will:
//   1. Check feature_flags.twilio_proxy_enabled
//   2. Check api_budgets.twilio_proxy daily cap
//   3. Pull a number from twilio_number_pool (assign or rotate)
//   4. POST to Twilio Proxy API to create a session with both participants
//   5. INSERT into phone_proxy_sessions with the proxy number
//   6. Return the masked number to the client to dial

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:proxy_session_create`,
      endpoint: 'proxy-session-create',
      limit: 10, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id } = parsed.data;

    const admin = adminClient();

    // Check Twilio is actually enabled
    const { data: flag } = await admin
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'twilio_proxy_enabled')
      .single();

    if (!flag?.enabled || !Deno.env.get('TWILIO_ACCOUNT_SID')) {
      // STUB MODE — return a clear "not configured" payload that the UI can show
      return jsonResponse(
        {
          ok: false,
          status: 'twilio_not_configured',
          message: 'Phone proxy is not yet enabled. The customer can use the in-app Message button in the meantime.',
        },
        { status: 200 },  // 200 so the client treats it as a soft state, not an error
        cors,
      );
    }

    // Verify booking + participants (admin client bypasses RLS for the lookup)
    const { data: booking } = await admin
      .from('bookings')
      .select('id, customer_id, assigned_driver_profile_id, status')
      .eq('id', booking_id)
      .single();
    if (!booking) throw httpError(404, 'Booking not found');

    const isParticipant =
      booking.customer_id === user.id || booking.assigned_driver_profile_id === user.id;
    if (!isParticipant && !['movvy_admin', 'movvy_support'].includes(user.role)) {
      throw httpError(403, 'Not a participant in this booking');
    }

    if (!booking.assigned_driver_profile_id) {
      throw httpError(400, 'No driver assigned yet');
    }

    // TODO when Twilio is live:
    //   1. Look up customer + driver E.164 phones from profiles
    //   2. Check phone_proxy_sessions for existing active session for this booking
    //      → if exists and not expired, return it
    //   3. Pull next available number from twilio_number_pool
    //   4. Call Twilio Proxy: POST /v1/Services/<SID>/Sessions with 2 participants
    //   5. Insert phone_proxy_sessions row
    //   6. Mark twilio_number_pool.active_session_id
    //   7. Log to api_spend_log (twilio_proxy service)
    //   8. Return { proxy_number, session_id, expires_at }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'proxy.session_requested_stub',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
    });

    return jsonResponse(
      {
        ok: false,
        status: 'twilio_not_configured',
        message: 'Twilio integration is staged but not yet activated.',
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[proxy-session-create] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
