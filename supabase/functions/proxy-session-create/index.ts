// =============================================================================
// POST /proxy-session-create
//
// Creates (or refreshes) a phone_proxy_sessions row for the booking and
// returns the Movvy/Twilio proxy number the caller should dial. The actual
// routing happens in /twilio-voice-webhook — Twilio hits that webhook the
// moment the proxy number rings, the webhook looks up the active session
// based on caller ID, and returns TwiML that forwards the call to the
// other party.
//
// What the receiving end sees: a regular incoming call from the Twilio
// number (the iOS / Android system call UI), not a custom in-app screen.
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

const Body = z.object({
  booking_id: z.string().uuid(),
});

// We extend the session every time a participant requests a call so the
// proxy stays alive for the duration of the move + a 24h cushion afterward
// (chat-like nudges, "where are my shoes?", etc.).
const SESSION_TTL_HOURS = 24;

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:proxy_session_create`,
      endpoint: 'proxy-session-create',
      limit: 10,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id } = parsed.data;

    const admin = adminClient();

    // ─── Check the flag + secrets ───────────────────────────────────────────
    // We require BOTH the flag flipped AND Twilio creds present so a half-
    // configured env can't accidentally lock people out.
    const { data: flag } = await admin
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'twilio_proxy_enabled')
      .single();

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioNumber =
      Deno.env.get('TWILIO_FROM_NUMBER') ?? Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!flag?.enabled || !accountSid || !twilioNumber) {
      return jsonResponse(
        {
          ok: false,
          status: 'twilio_not_configured',
          message:
            "Phone calling isn't enabled yet. Use the in-app Message button to chat with your crew.",
        },
        { status: 200 },
        cors,
      );
    }

    // ─── Resolve the booking + both phones ──────────────────────────────────
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
      return jsonResponse(
        {
          ok: false,
          status: 'no_driver_assigned',
          message: "Your crew hasn't accepted yet — calling is available once they do.",
        },
        { status: 200 },
        cors,
      );
    }

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, phone')
      .in('id', [booking.customer_id, booking.assigned_driver_profile_id]);
    const customerPhone = profiles?.find((p) => p.id === booking.customer_id)?.phone;
    const driverPhone = profiles?.find(
      (p) => p.id === booking.assigned_driver_profile_id,
    )?.phone;

    if (!customerPhone || !/^\+[1-9]\d{6,14}$/.test(customerPhone)) {
      return jsonResponse(
        {
          ok: false,
          status: 'customer_phone_missing',
          message:
            "We don't have a verified phone for the customer. Add one in Profile → Phone to enable calls.",
        },
        { status: 200 },
        cors,
      );
    }
    if (!driverPhone || !/^\+[1-9]\d{6,14}$/.test(driverPhone)) {
      return jsonResponse(
        {
          ok: false,
          status: 'driver_phone_missing',
          message:
            "The driver hasn't verified a phone yet — they need to add one in Profile → Phone before calls work.",
        },
        { status: 200 },
        cors,
      );
    }

    // ─── Create or refresh the session ──────────────────────────────────────
    // The unique constraint on booking_id means one session per booking.
    // Re-calling this endpoint just extends the TTL.
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    const { data: existing } = await admin
      .from('phone_proxy_sessions')
      .select('id, status, expires_at')
      .eq('booking_id', booking_id)
      .maybeSingle();

    let sessionId: string;
    if (existing) {
      const { error } = await admin
        .from('phone_proxy_sessions')
        .update({
          customer_phone_e164: customerPhone,
          driver_phone_e164: driverPhone,
          twilio_proxy_number: twilioNumber,
          status: 'active',
          expires_at: expiresAt,
        })
        .eq('id', existing.id);
      if (error) throw error;
      sessionId = existing.id;
    } else {
      const { data: created, error } = await admin
        .from('phone_proxy_sessions')
        .insert({
          booking_id,
          customer_profile_id: booking.customer_id,
          driver_profile_id: booking.assigned_driver_profile_id,
          customer_phone_e164: customerPhone,
          driver_phone_e164: driverPhone,
          twilio_proxy_number: twilioNumber,
          status: 'active',
          expires_at: expiresAt,
        })
        .select('id')
        .single();
      if (error) throw error;
      sessionId = created.id;
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'proxy.session_active',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { session_id: sessionId, proxy_number: twilioNumber },
    });

    return jsonResponse(
      {
        ok: true,
        proxy_number: twilioNumber,
        session_id: sessionId,
        expires_at: expiresAt,
        message: 'Calling — your number stays private.',
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
