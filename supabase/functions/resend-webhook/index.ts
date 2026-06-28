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
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[resend-webhook] Supabase env missing');
    return new Response('Server misconfigured', { status: 500 });
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
      console.warn('[resend-webhook] missing svix headers');
      return new Response('Bad request', { status: 400 });
    }

    // Reject signatures older than 5 minutes — replay protection.
    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return new Response('Stale signature', { status: 400 });
    }

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const keyBytes = base64Decode(secret.replace(/^whsec_/, ''));
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
      console.warn('[resend-webhook] signature mismatch');
      return new Response('Invalid signature', { status: 401 });
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
  const tags: Array<{ name?: string; value?: string }> = data?.tags ?? [];
  const template = tags.find((t) => t.name === 'template')?.value ?? null;
  const kind = tags.find((t) => t.name === 'kind')?.value ?? null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Bounce extraction ─────────────────────────────────────────────────────
  // Resend's bounce payload includes a sub-object with hard/soft type +
  // reason. Pull it out into top-level columns so the admin can sort.
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
    // Don't 500 here — Resend will retry indefinitely if we do, which floods
    // the table. Acknowledge receipt and log so we can investigate.
  }

  return new Response('ok', { status: 200 });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
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
