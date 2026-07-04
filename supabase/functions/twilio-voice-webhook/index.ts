// =============================================================================
// POST /twilio-voice-webhook
//
// Twilio calls this URL the moment someone dials our proxy number. The body
// is form-encoded with Twilio's standard call params (From, To, CallSid…).
//
// We:
//   1. Verify the request is genuinely from Twilio (X-Twilio-Signature)
//   2. Look up the active phone_proxy_sessions row matching the caller's
//      real number (From) and the called proxy number (To)
//   3. Decide who the OTHER party is and respond with TwiML that tells
//      Twilio to dial that party — which makes the other phone ring with
//      a regular incoming call from our Twilio number
//
// This is what gives the receiving end a "real incoming call" on the lock
// screen (iOS / Android system call UI) instead of an in-app overlay. No
// CallKit / PushKit / VoIP push needed — Twilio + the carrier handle it.
//
// CONFIGURE: Set this webhook URL on your Twilio number's Voice config:
//   Twilio Console → Phone Numbers → Active numbers → click your number
//   → Voice Configuration → "A CALL COMES IN" → Webhook
//   → https://<project-ref>.supabase.co/functions/v1/twilio-voice-webhook
//   → HTTP POST
// =============================================================================

import {
  adminClient,
  HttpError,
} from '../_shared/security.ts';

// Twilio TwiML responses are XML. We hand-roll the tiny snippets needed
// instead of pulling a library — keeps the edge function small and fast.
function twiml(body: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

function reject(reason: string): Response {
  // <Reject> sends busy/declined to the caller. Cleaner than letting the
  // call ring forever or playing a stub TTS.
  console.warn('[twilio-voice-webhook] rejecting:', reason);
  return twiml('<Reject reason="busy"/>');
}

// Verify that this request actually came from Twilio by recomputing the
// X-Twilio-Signature header from the URL + sorted form params + auth token.
// See https://www.twilio.com/docs/usage/webhooks/webhooks-security
async function verifyTwilioSignature(req: Request, body: URLSearchParams): Promise<boolean> {
  const sig = req.headers.get('X-Twilio-Signature');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!sig || !token) return false;

  // The signature is HMAC-SHA1 over: full URL + each form param sorted
  // alphabetically and concatenated as key+value (no separator).
  const sortedKeys = [...body.keys()].sort();
  let raw = req.url;
  for (const key of sortedKeys) raw += key + (body.get(key) ?? '');

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(token),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(raw));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return computed === sig;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  // Twilio always POSTs voice events.
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Twilio sends application/x-www-form-urlencoded
  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await req.text());
  } catch {
    return reject('bad body');
  }

  // Verify the signature. FAIL CLOSED: a missing TWILIO_AUTH_TOKEN in
  // production would previously skip verification silently, turning this
  // RLS-bypassing webhook into an unauthenticated endpoint. Local dev must
  // now opt out explicitly with TWILIO_ALLOW_UNSIGNED=1 (never set in prod).
  const allowUnsigned = Deno.env.get('TWILIO_ALLOW_UNSIGNED') === '1';
  if (!allowUnsigned) {
    if (!Deno.env.get('TWILIO_AUTH_TOKEN')) {
      console.error('[twilio-voice-webhook] TWILIO_AUTH_TOKEN unset — refusing unsigned request');
      return reject('unauthorized');
    }
    const ok = await verifyTwilioSignature(req, body);
    if (!ok) {
      console.warn('[twilio-voice-webhook] signature mismatch');
      return reject('unauthorized');
    }
  }

  const from = body.get('From'); // caller's real E.164
  const to = body.get('To'); // our proxy number (E.164)
  const callSid = body.get('CallSid');
  if (!from || !to) return reject('missing From/To');

  // Both numbers are interpolated into a PostgREST .or() filter below on the
  // admin (RLS-bypassing) client, so validate the E.164 shape first — a
  // stray comma/paren in `From` could otherwise reshape the filter. Twilio
  // always sends E.164; anything else is not a real Twilio call.
  const E164 = /^\+[1-9]\d{6,14}$/;
  if (!E164.test(from) || !E164.test(to)) return reject('bad From/To');

  try {
    const admin = adminClient();

    // Look up the most recent ACTIVE session where the caller is one of the
    // two participants AND the called number matches our proxy. The booking_id
    // unique-index means at most one active session per booking, but a
    // participant could have several historical bookings — sort by created_at
    // desc and pick the freshest.
    const { data: session, error } = await admin
      .from('phone_proxy_sessions')
      .select(
        'id, customer_phone_e164, driver_phone_e164, twilio_proxy_number, status, expires_at, booking_id',
      )
      .or(`customer_phone_e164.eq.${from},driver_phone_e164.eq.${from}`)
      .eq('twilio_proxy_number', to)
      .in('status', ['pending', 'active'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[twilio-voice-webhook] db error', error);
      return reject('lookup failed');
    }
    if (!session) return reject('no active session for caller');

    // Figure out which leg of the bridge is the OTHER party.
    const target =
      from === session.customer_phone_e164
        ? session.driver_phone_e164
        : session.customer_phone_e164;
    const direction =
      from === session.customer_phone_e164
        ? 'customer_to_driver'
        : 'driver_to_customer';

    // Log the call attempt for billing reconciliation + abuse detection.
    await admin.from('phone_proxy_events').insert({
      session_id: session.id,
      kind: 'call',
      direction,
      twilio_sid: callSid ?? null,
      status: 'in_progress',
    });

    // <Dial callerId> spoofs the OUR proxy number on the outgoing leg, so the
    // recipient sees the call coming from Movvy's number — not the original
    // caller's real phone. That's the whole point of the proxy.
    // timeout=30 → ring for 30 seconds before giving up (default is 30 anyway,
    // kept explicit). action= would let us update the event row on hangup
    // but we keep this stateless for now.
    return twiml(
      `<Dial callerId="${escapeXml(to)}" timeout="30" answerOnBridge="true">${escapeXml(target)}</Dial>`,
    );
  } catch (e) {
    if (e instanceof HttpError) return reject(e.message);
    console.error('[twilio-voice-webhook] unhandled', e);
    return reject('internal error');
  }
});

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch),
  );
}
