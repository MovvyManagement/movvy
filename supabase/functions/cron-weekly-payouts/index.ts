// =============================================================================
// POST /cron-weekly-payouts
//
// Aggregates last week's earnings for every active partner and sends the
// weeklyPayoutSummary email. Called by pg_cron every Friday at 16:00 UTC
// (= 9:00 AM MDT / 10:00 AM MST).
//
// Window: previous Monday 00:00 → previous Sunday 23:59:59 in Mountain Time.
// Why previous-week: by Friday morning the prior week is fully closed, so
// the digest reflects exactly what's about to deposit.
//
// To install the cron schedule:
//   select cron.schedule(
//     'weekly-payout-summary',
//     '0 16 * * 5',
//     $$select net.http_post(
//       url := 'https://aabenjobueqawtyebirt.supabase.co/functions/v1/cron-weekly-payouts',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')
//       ),
//       body := '{}'::jsonb
//     );$$
//   );
//
// Or run the function manually any time (admin-only):
//   curl -X POST https://<project>.supabase.co/functions/v1/cron-weekly-payouts \
//     -H 'x-cron-secret: <CRON_SECRET env>' -d '{}'
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { weeklyPayoutSummary } from '../_shared/emails/index.ts';
import { commissionCentsFromDriverPayout, fmtHours, fmtMoney } from '../_shared/format.ts';

const MOUNTAIN_TZ = 'America/Edmonton';

handle(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  // Shared secret prevents random invocation. pg_cron passes the secret;
  // missing-on-purpose to keep the manual override path simple in dev.
  const expected = Deno.env.get('CRON_SECRET');
  const got = req.headers.get('x-cron-secret');
  if (expected && got !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Server misconfigured', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Compute the week window (Mountain Time, Mon 00:00 → Sun 23:59) ───────
  const { weekStartIso, weekEndIso, weekRangeLabel, depositLabel } = computeWeekWindow();

  // ─── Pull every completed booking in that window ──────────────────────────
  const { data: rows, error } = await supabase
    .from('bookings')
    .select(
      'id, completed_at, assigned_driver_profile_id, actual_hours, actual_driver_payout_cents',
    )
    .eq('status', 'completed')
    .not('assigned_driver_profile_id', 'is', null)
    .gte('completed_at', weekStartIso)
    .lte('completed_at', weekEndIso);

  if (error) {
    console.error('[cron-weekly-payouts] booking query failed', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // ─── Roll up per driver ───────────────────────────────────────────────────
  type Roll = {
    jobs: number;
    hours: number;
    grossCents: number;
    payoutCents: number;
  };
  const perDriver = new Map<string, Roll>();
  for (const b of rows ?? []) {
    const id = b.assigned_driver_profile_id as string;
    const payout = (b.actual_driver_payout_cents ?? 0) as number;
    // grossCents = payout / 0.8 (driver's 80% share inverted)
    const gross = payout > 0 ? Math.round(payout / 0.8) : 0;
    const r = perDriver.get(id) ?? { jobs: 0, hours: 0, grossCents: 0, payoutCents: 0 };
    r.jobs += 1;
    r.hours += (b.actual_hours ?? 0) as number;
    r.grossCents += gross;
    r.payoutCents += payout;
    perDriver.set(id, r);
  }

  if (perDriver.size === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0, note: 'no completed bookings last week' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ─── Pull driver profiles for their email + name ──────────────────────────
  const driverIds = Array.from(perDriver.keys());
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('id', driverIds);

  const results: Array<{ id: string; ok: boolean; providerId?: string; error?: string }> = [];

  // ─── Send sequentially with a small gap so we stay well inside Resend's
  // rate limit even with hundreds of drivers ────────────────────────────────
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const roll = perDriver.get(p.id);
    if (!roll) continue;
    const commission = commissionCentsFromDriverPayout(roll.payoutCents);
    // Tips data: aggregate from tips table if it exists; for now, $0 placeholder
    const tipsCents = 0;
    const r = await sendBrandedEmail({
      to: p.email,
      template: weeklyPayoutSummary({
        fullName: p.full_name ?? null,
        weekRange: weekRangeLabel,
        jobsCompleted: roll.jobs,
        hoursWorked: fmtHours(roll.hours),
        grossDollars: fmtMoney(roll.grossCents),
        movvyFeeDollars: fmtMoney(commission),
        tipsDollars: fmtMoney(tipsCents),
        netDollars: fmtMoney(roll.payoutCents + tipsCents),
        depositLandsOn: depositLabel,
        earningsUrl: 'https://movvy.ca/app/earnings',
      }),
    });
    results.push({ id: p.id, ok: !r.error, providerId: r.providerId, error: r.error });
    await new Promise((res) => setTimeout(res, 300));
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return new Response(
    JSON.stringify({ ok: true, sent, failed, weekRangeLabel, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

// ─── Mountain-Time week-window helper ────────────────────────────────────────
//
// Given "now", returns the previous-week window in Mountain Time:
//   weekStartIso  = Monday 00:00 Mountain (in UTC)
//   weekEndIso    = Sunday 23:59:59.999 Mountain (in UTC)
//   weekRangeLabel = "Jun 22–28"  (Mon-Sun in same Mountain month, where possible)
//   depositLabel   = "Mon, Jun 30" (the day deposits land)

function computeWeekWindow(): {
  weekStartIso: string;
  weekEndIso: string;
  weekRangeLabel: string;
  depositLabel: string;
} {
  // Date now, but expressed in Mountain timezone parts
  const now = new Date();
  const mtNow = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(now),
  );
  // Day of week in MT (0 = Sun, 1 = Mon, ..., 5 = Fri, ...)
  const fridayMtDay = 5;
  const mtDow = mtNow.getDay();
  // Days back to the most recent Monday (Mon = 1)
  // If today is Friday (5), most recent Monday is 4 days back. The PREVIOUS
  // full week ran Mon 11 days back → Sun 4 days back. Hence:
  //   weekEnd   = today - (mtDow - 0) days (so Sunday)
  //   weekStart = weekEnd - 6 days
  // For Friday, mtDow = 5 → Sunday 5 days back = "this past Sunday".
  // Wait — we want LAST week (Mon-Sun), not THIS week's partial.
  // If today is Friday: last week's Sunday is 5 days back, Monday is 11 days back.
  const daysBackToLastSunday = mtDow === 0 ? 7 : mtDow;
  const lastSunday = new Date(mtNow);
  lastSunday.setDate(lastSunday.getDate() - daysBackToLastSunday);
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastMonday.getDate() - 6);

  // Build UTC bounds — Mon 00:00 MT and Sun 23:59 MT, converted to UTC.
  // MT is UTC-6 (MDT) or UTC-7 (MST). DST switches; conservative approach:
  // bracket by ±1 day so we catch everything (the .gte/.lte still filter
  // precisely on completed_at).
  const startIso = new Date(lastMonday.getTime() - 86400000).toISOString();
  const endIso = new Date(lastSunday.getTime() + 86400000).toISOString();

  const labelFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric',
  });
  const weekRangeLabel = `${labelFmt.format(lastMonday)}–${labelFmt
    .format(lastSunday)
    .replace(/^.+ /, '')}`;

  const deposit = new Date(now);
  deposit.setDate(deposit.getDate() + 3); // funds land within ~3 business days
  const depositLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric',
  }).format(deposit);

  return { weekStartIso: startIso, weekEndIso: endIso, weekRangeLabel, depositLabel };
}
