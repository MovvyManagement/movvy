// =============================================================================
// POST /resend-webhook
//
// Receives Resend webhook events (email.sent / .delivered / .bounced /
// .complained / .opened / .clicked) and writes them to the email_events
// table. Lets us:
//   • show delivery status next to each user in the admin
//   • detect hard bounces and stop emailing dead addresses
//   • measure open/click rates per template
//
// Security:
//   • Verifies the Svix-style HMAC signature Resend sends with every webhook
//     (RESEND_WEBHOOK_SECRET must be set as a Supabase secret)
//   • No auth required — this endpoint accepts unauthenticated POSTs by
//     design, but rejects anything without a valid signature
//
// References:
//   https://resend.com/docs/dashboard/webhooks/verify-webhooks
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handle } from '../_shared/serve.ts';

handle(async (req) => {
  // Top-level try/catch so any unhandled exception surfaces in the response
  // body — Resend's dashboard shows that text under "Response body" for each
  // failed delivery attempt, so we can diagnose without combing log files.
  try {
    return await processWebhook(req);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const stack = err?.stack ?? '';
    console.error('[resend-webhook] unhandled', message, stack);
    return new Response(
      JSON.stringify({ ok: false, error: message, stack: stack.split('\n').slice(0, 4) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

async function processWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[resend-webhook] Supabase env missing');
    return new Response(
      JSON.stringify({ ok: false, error: 'Supabase env missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rawBody = await req.text();

  // ─── Signature verification ────────────────────────────────────────────────
  // Resend uses Svix's signature format: `v1,<base64-hmac>` in svix-signature.
  // If you skip verification, anyone can write rows into email_events.
  if (secret) {
    const svixId = req.headers.get('svix-id') ?? '';
    const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
    const svixSignatureHeader = req.headers.get('svix-signature') ?? '';

    if (!svixId || !svixTimestamp || !svixSignatureHeader) {
      console.warn('[resend-webhook] missing svix headers', {
        hasId: !!svixId, hasTs: !!svixTimestamp, hasSig: !!svixSignatureHeader,
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing svix headers' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Reject signatures older than 5 minutes — replay protection.
    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Stale signature',
          detail: { svix_timestamp: svixTimestamp, our_time_s: Math.floor(Date.now() / 1000) },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let keyBytes: Uint8Array;
    try {
      keyBytes = base64Decode(secret.replace(/^whsec_/, ''));
    } catch (e: any) {
      console.error('[resend-webhook] base64 decode of secret failed', e?.message);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Cannot decode RESEND_WEBHOOK_SECRET as base64',
          detail: e?.message ?? String(e),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signedPayload),
    );
    const expected = base64Encode(new Uint8Array(sigBytes));

    // The header is a space-separated list of `v1,<base64>` pairs — accept
    // the event if any one of them matches.
    const candidates = svixSignatureHeader
      .split(' ')
      .map((s) => s.split(',')[1])
      .filter(Boolean);
    const ok = candidates.some((c) => timingSafeEqual(c, expected));
    if (!ok) {
      console.warn('[resend-webhook] signature mismatch', {
        receivedCount: candidates.length,
        firstReceived: candidates[0]?.slice(0, 12) + '...',
        expectedFirst: expected.slice(0, 12) + '...',
        secretLen: keyBytes.length,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invalid signature',
          detail: {
            received_sigs: candidates.length,
            secret_decoded_bytes: keyBytes.length,
            expected_prefix: expected.slice(0, 12),
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } else {
    console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET not set — accepting unverified payload (DEV ONLY)');
  }

  // ─── Parse + insert ────────────────────────────────────────────────────────
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const eventType = String(payload?.type ?? '').replace(/^email\./, '');
  const data = payload?.data ?? {};

  // Resend's webhook payload sends tags as an OBJECT (e.g. `{kind: "customer",
  // template: "bookingConfirmed"}`) even though the SEND API accepts an array
  // of `{name, value}` pairs. Handle both shapes so this code stays correct if
  // Resend ever changes the payload format.
  let template: string | null = null;
  let kind: string | null = null;
  const rawTags = data?.tags;
  if (Array.isArray(rawTags)) {
    template = rawTags.find((t: any) => t?.name === 'template')?.value ?? null;
    kind = rawTags.find((t: any) => t?.name === 'kind')?.value ?? null;
  } else if (rawTags && typeof rawTags === 'object') {
    template = (rawTags as Record<string, any>).template ?? null;
    kind = (rawTags as Record<string, any>).kind ?? null;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Bounce / click / open extraction ──────────────────────────────────────
  const bounceType =
    eventType === 'bounced' ? data?.bounce?.type ?? 'undetermined' : null;
  const bounceReason =
    eventType === 'bounced' ? data?.bounce?.message ?? null : null;
  const url = eventType === 'clicked' ? data?.click?.link ?? null : null;
  const recipient =
    Array.isArray(data?.to) ? String(data.to[0]).toLowerCase() : null;

  const { error } = await supabase.from('email_events').insert({
    provider_id: data?.email_id ?? data?.id ?? 'unknown',
    event_type: eventType,
    template,
    kind,
    recipient,
    subject: data?.subject ?? null,
    bounce_type: bounceType,
    bounce_reason: bounceReason,
    url,
    raw: payload,
    occurred_at: data?.created_at ? new Date(data.created_at).toISOString() : new Date().toISOString(),
  });

  if (error) {
    console.error('[resend-webhook] insert failed', error);
    // Don't 500 here — Resend would retry indefinitely. Acknowledge receipt
    // and log; we can backfill from the raw payload if needed.
  }

  return new Response('ok', { status: 200 });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64Decode(s: string): Uint8Array {
  // Accept both standard and URL-safe base64 (some senders use the latter)
  let normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to multiple of 4
  while (normalized.length % 4 !== 0) normalized += '=';
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
