// =============================================================================
// POST /send-test-emails  ← DEV UTILITY (not user-facing).
//
// Fires all 10 transactional email templates at a given address using the
// real _shared/email.ts pipeline. Useful for previewing the entire suite
// in Gmail / Outlook / Apple Mail any time you tweak a template, before
// shipping the change behind a real business event.
//
// Body:  { "to": "you@example.com", "secret": "<TEST_EMAIL_SECRET env>" }
//
// Invoke from the terminal:
//   SECRET=<from supabase secrets list> &&
//   curl -X POST 'https://<project>.supabase.co/functions/v1/send-test-emails' \
//     -H 'Content-Type: application/json' \
//     -d "{\"to\":\"you@example.com\",\"secret\":\"$SECRET\"}"
//
// Gated by TEST_EMAIL_SECRET so anyone hitting the URL without the secret
// gets a 403. Safe to leave deployed.
// =============================================================================

import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import {
  welcomeCustomer,
  bookingConfirmed,
  bookingCancelled,
  moveComplete,
  accountDeleted,
  moverApplicationReceived,
  moverApproved,
  moverApplicationDeclined,
  docNeedsResubmission,
  weeklyPayoutSummary,
} from '../_shared/emails/index.ts';

handle(async (req) => {
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405 });
  }

  // Shared-secret guard so this endpoint can't be spammed.
  const expected = Deno.env.get('TEST_EMAIL_SECRET');
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (expected && body.secret !== expected) {
    return new Response('Forbidden', { status: 403 });
  }
  const to = body.to;
  if (!to || typeof to !== 'string') {
    return new Response('Missing "to"', { status: 400 });
  }

  // ─── Realistic dummy data for every template ───────────────────────────────
  const fullName = 'Adam Hmedat';
  const shortCode = 'MV-9001';
  const scheduledStart = 'Sat, Jul 11 · 8:00 AM';
  const scheduledWindow = '8:00 AM – 12:00 PM';
  const pickup = '123 17 Ave SW, Calgary, AB';
  const dropoff = '4502 Elbow Dr SW, Calgary, AB';
  const appUrl = 'https://movvy.ca/app';

  const templates = [
    {
      key: 'welcomeCustomer',
      template: welcomeCustomer({ fullName }),
    },
    {
      key: 'bookingConfirmed',
      template: bookingConfirmed({
        fullName,
        shortCode,
        pickupAddress: pickup,
        dropoffAddress: dropoff,
        scheduledStart,
        scheduledWindow,
        crewSize: 2,
        estimatedTotalDollars: '$1,420',
        bookingUrl: appUrl,
      }),
    },
    {
      key: 'bookingCancelled',
      template: bookingCancelled({
        fullName,
        shortCode,
        scheduledStart,
        cancelledBy: 'customer',
        reason: 'Customer rescheduled to a different week.',
        refundedAmount: '$0',
        rebookUrl: appUrl,
      }),
    },
    {
      key: 'moveComplete',
      template: moveComplete({
        fullName,
        shortCode,
        crewLeadName: 'Marco',
        actualHours: '3.5 hrs',
        actualTotalDollars: '$1,612',
        receiptUrl: `${appUrl}/receipts/${shortCode}`,
        rateUrl: `${appUrl}/rate/${shortCode}`,
      }),
    },
    {
      key: 'accountDeleted',
      template: accountDeleted({
        fullName,
        hardDeleteOn: 'July 28, 2026',
      }),
    },
    {
      key: 'moverApplicationReceived',
      template: moverApplicationReceived({ fullName }),
    },
    {
      key: 'moverApproved',
      template: moverApproved({ fullName, appUrl }),
    },
    {
      key: 'moverApplicationDeclined',
      template: moverApplicationDeclined({
        fullName,
        reason:
          'The provided vehicle registration appears to have expired in 2024. We require an active registration to verify insurance coverage.',
        reapplyAfter: 'in 90 days, once the registration is renewed',
      }),
    },
    {
      key: 'docNeedsResubmission',
      template: docNeedsResubmission({
        fullName,
        docName: "Driver's License",
        reason:
          'The photo is too dark to read the expiry date. Please retake in natural light with all four corners visible.',
        uploadUrl: `${appUrl}/onboarding/documents`,
      }),
    },
    {
      key: 'weeklyPayoutSummary',
      template: weeklyPayoutSummary({
        fullName,
        weekRange: 'Jun 22–28',
        jobsCompleted: 6,
        hoursWorked: '23.5 hrs',
        grossDollars: '$2,940',
        movvyFeeDollars: '$588',
        tipsDollars: '$120',
        netDollars: '$2,472',
        depositLandsOn: 'Mon, Jun 30',
        earningsUrl: `${appUrl}/earnings`,
      }),
    },
  ];

  // ─── Fire sequentially so Resend's rate limit doesn't bite (~2/sec) ────────
  const results: Array<{ key: string; ok: boolean; providerId?: string; error?: string }> = [];
  for (const { key, template } of templates) {
    const r = await sendBrandedEmail({ to, template });
    results.push({ key, ok: !r.error, providerId: r.providerId, error: r.error });
    // Tiny gap so we stay well inside free-tier rate limits.
    await new Promise((res) => setTimeout(res, 400));
  }

  const summary = {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
