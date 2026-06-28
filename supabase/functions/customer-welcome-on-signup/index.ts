// =============================================================================
// POST /customer-welcome-on-signup
//
// Called by a Supabase Database Webhook on INSERT into the `profiles` table
// where role = 'customer'. Sends the branded welcomeCustomer email so the
// customer gets a "welcome to Movvy" greeting moments after their OTP signup
// finishes.
//
// Why a webhook instead of mobile-app-side fire:
//   • Catches every signup path (mobile, future web, admin-seeded accounts)
//   • Survives mobile-app crashes between OTP-verify and home-screen-load
//   • Easy to backfill historical accounts if we ever want to (re-fire the
//     webhook for old rows via INSERT ... ON CONFLICT DO NOTHING)
//
// To configure (one-time, manual in Supabase dashboard):
//   Database → Webhooks → Create
//     Name:         customer-welcome
//     Table:        public.profiles
//     Events:       INSERT
//     Type:         Supabase Edge Functions
//     Edge Function: customer-welcome-on-signup
//     HTTP Params:  none
//     HTTP Headers: { "x-webhook-secret": "<DB_WEBHOOK_SECRET env>" }
//
// The webhook payload Supabase sends is { type: 'INSERT', table, record, ... }.
// =============================================================================

import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { welcomeCustomer } from '../_shared/emails/index.ts';

handle(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  // Shared-secret check — without it anyone hitting the function URL could
  // trigger welcomes for arbitrary email addresses.
  const expected = Deno.env.get('DB_WEBHOOK_SECRET');
  const got = req.headers.get('x-webhook-secret');
  if (expected && got !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // Supabase DB webhook payload shape
  const record = payload?.record ?? payload?.new ?? {};
  if (payload?.type && payload.type !== 'INSERT') {
    return new Response(JSON.stringify({ skipped: 'not_an_insert' }), { status: 200 });
  }
  if (record?.role !== 'customer') {
    return new Response(JSON.stringify({ skipped: 'not_a_customer' }), { status: 200 });
  }
  if (!record?.email) {
    return new Response(JSON.stringify({ skipped: 'no_email' }), { status: 200 });
  }

  const result = await sendBrandedEmail({
    to: record.email,
    template: welcomeCustomer({ fullName: record.full_name ?? null }),
  });

  if (result.error) {
    console.warn('[customer-welcome-on-signup] send failed', result.error);
  }

  return new Response(
    JSON.stringify({ ok: !result.error, providerId: result.providerId, error: result.error }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
