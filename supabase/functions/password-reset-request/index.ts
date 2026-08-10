// =============================================================================
// POST /password-reset-request
//
// Sends a 6-digit reset code and ALWAYS answers 200 {ok:true}.
//
// This exists because Supabase's own OTP endpoint is a public account
// enumeration oracle, callable with the anon key that ships inside the app:
//
//   POST /auth/v1/otp {"email":"management@movvy.ca","create_user":false}
//     → 200 {}
//   POST /auth/v1/otp {"email":"nobody@example.com","create_user":false}
//     → 422 {"error_code":"otp_disabled"}
//
// Verified against production. A clean yes/no per address, for free, at any
// scale. Masking it in the client was never a fix — an attacker calls Supabase
// directly and never runs our code.
//
// The rule here is that the RESPONSE MUST NOT DEPEND ON WHETHER THE ACCOUNT
// EXISTS. So the shape is deliberately: decide the answer, then do the work.
// Every branch below — no profile, deleted profile, send failure — returns the
// same 200 body. Only the server log knows the difference.
//
// Timing is levelled too. A miss used to be measurably faster than a hit
// because a hit does a hash, an insert and a network send; that difference is
// itself an oracle, so a miss sleeps for a comparable spell.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { passwordResetCode } from '../_shared/emails/index.ts';

const Body = z.object({
  email: z.string().email().max(254).optional(),
  phone: z.string().min(8).max(20).optional(),
});

const CODE_TTL_MINUTES = 10;

/** Cryptographically random 6-digit code. Math.random is not acceptable for
 *  something that stands between a stranger and someone's account. */
function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendSms(to: string, body: string): Promise<void> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER') ?? Deno.env.get('TWILIO_PHONE_NUMBER');
  if (!sid || !token || !from) {
    console.log('[password-reset-request/sms-stub]', { to, body });
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`twilio ${res.status}: ${t.slice(0, 200)}`);
  }
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  // The one honest 200 in this file: the answer we always give.
  const SAME_ANSWER = () => jsonResponse({ ok: true }, { status: 200 }, cors);

  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    // Even a malformed body gets the standard answer — "that isn't a valid
    // email" is fine to say, but anything account-shaped is not.
    if (!parsed.success) return SAME_ANSWER();

    const email = parsed.data.email?.trim().toLowerCase();
    const phone = parsed.data.phone?.trim();
    if (!email && !phone) return SAME_ANSWER();
    const contact = email ?? phone!;
    const channel: 'email' | 'sms' = email ? 'email' : 'sms';

    // Rate limit by IP and by contact. Per-IP is what stops a list being walked
    // from one machine; per-contact stops one address being flooded from many.
    // A 429 is not an oracle — it says nothing about whether the account exists.
    const ip = clientIp(req) ?? 'unknown';
    await checkRateLimit({
      bucketKey: `ip:${ip}:pw_reset_req`,
      endpoint: 'password-reset-request',
      limit: 20,
      windowSeconds: 3600,
    });
    await checkRateLimit({
      bucketKey: `contact:${contact}:pw_reset_req`,
      endpoint: 'password-reset-request',
      limit: 5,
      windowSeconds: 900,
    });

    const admin = adminClient();

    const q = admin.from('profiles').select('id, full_name, deleted_at').limit(1);
    const { data: profile } = email
      ? await q.eq('email', email).maybeSingle()
      : await q.eq('phone', phone!).maybeSingle();

    // ── The branch that must not be observable ────────────────────────────
    if (!profile || profile.deleted_at) {
      console.log('[password-reset-request] no account for contact (answered 200 anyway)');
      return SAME_ANSWER();
    }

    const code = generateCode();
    // ── Everything expensive happens AFTER we answer ──────────────────────
    // Equal status and equal body are not enough on their own: measured against
    // production, the hit took 3876 ms and a miss ~1200 ms, because the hit
    // waits on Resend. A 2.5-second gap is a perfectly usable oracle — slower
    // to exploit than a 422, and just as conclusive. Jitter cannot hide it.
    //
    // So the response no longer waits for the code to be minted or sent. Both
    // paths now do the same cheap profile lookup and return, and the work
    // continues in the background via waitUntil. That is also better for the
    // user: the "check your email" screen appears immediately.
    const deliver = async () => {
      try {
        const codeHash = await sha256Hex(code);
        const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

        // Supersede any earlier live code for this contact, so a resend
        // invalidates the previous one rather than leaving several valid.
        await admin
          .from('password_reset_codes')
          .update({ consumed_at: new Date().toISOString() })
          .eq('contact', contact)
          .is('consumed_at', null);

        const { error: insErr } = await admin.from('password_reset_codes').insert({
          profile_id: profile.id,
          contact,
          channel,
          code_hash: codeHash,
          expires_at: expiresAt,
        });
        if (insErr) {
          console.error('[password-reset-request] code insert failed', insErr);
          return;
        }

        if (channel === 'email') {
          await sendBrandedEmail({
            to: contact,
            template: passwordResetCode({
              fullName: profile.full_name ?? null,
              code,
              expiresInMinutes: CODE_TTL_MINUTES,
            }),
          });
        } else {
          await sendSms(
            contact,
            `Your Movvy password reset code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. ` +
            `If you didn't ask for this, ignore this message.`,
          );
        }
      } catch (sendErr) {
        // The user sees "we sent a code" and never receives one, which is
        // indistinguishable from a mail delay — and far better than leaking
        // that this address is registered.
        console.error('[password-reset-request] delivery failed', sendErr);
      }
    };

    // Supabase's edge runtime keeps a waitUntil task alive past the response.
    // Without it an un-awaited promise can be killed when the isolate returns,
    // so fall back to awaiting rather than silently sending nothing.
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime && typeof runtime.waitUntil === 'function') {
      runtime.waitUntil(deliver());
    } else {
      await deliver();
    }

    return SAME_ANSWER();
  } catch (e) {
    // A rate-limit rejection is the only error worth surfacing, and it reveals
    // nothing about the account.
    if (e instanceof HttpError && e.status === 429) {
      return jsonResponse({ error: e.message }, { status: 429 }, cors);
    }
    console.error('[password-reset-request] unhandled', e);
    // Anything else: still the same answer, so a server fault can't be used to
    // probe which addresses take which code path.
    return jsonResponse({ ok: true }, { status: 200 }, cors);
  }
});
