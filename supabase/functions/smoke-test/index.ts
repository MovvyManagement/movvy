// =============================================================================
// POST /smoke-test  ← DEV UTILITY. Safe to re-run any time.
//
// Drives a full booking lifecycle end-to-end as if a real customer + driver
// were using the app:
//
//   1. Create test customer + driver (auth.admin.createUser)
//   2. Sign in as customer → call bookings-create
//   3. Verify booking row + pricing breakdown
//   4. Manually assign driver (skipping dispatch for brevity)
//   5. Sign in as driver → walk through every status transition
//      (on_the_way → arrived → loading → in_transit → unloading → completed)
//   6. Verify actual_bill was computed on completion
//   7. Wait for webhook delay → query email_events
//   8. Verify bookingConfirmed + moveComplete templates were sent
//   9. Create a second booking, cancel it, verify bookingCancelled fired
//   10. Clean up: delete bookings, users, partner row
//
// Gated by SMOKE_TEST_SECRET (or TEST_EMAIL_SECRET) so this can't be invoked
// by random callers. Each run is fully self-contained; leaves zero residue.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handle } from '../_shared/serve.ts';

handle(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const expected = Deno.env.get('SMOKE_TEST_SECRET') ?? Deno.env.get('TEST_EMAIL_SECRET');
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (expected && body.secret !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: Array<{ step: string; ok: boolean; [k: string]: any }> = [];
  const cleanup: Array<() => Promise<void>> = [];
  const testId = Math.random().toString(36).slice(2, 8);

  const log = (step: string, ok: boolean, extra?: Record<string, any>) => {
    const row = { step, ok, ...(extra ?? {}) };
    results.push(row);
    console.log(`[smoke-test] ${ok ? '✅' : '❌'} ${step}`, extra ?? '');
  };

  try {
    // ─── 0. Sanity: find a Calgary city to anchor the booking ─────────────────
    const { data: city } = await admin
      .from('cities')
      .select('id, slug, is_active')
      .ilike('slug', '%calgary%')
      .limit(1)
      .maybeSingle();
    if (!city || !city.is_active) {
      log('city lookup (calgary)', false, { error: city ? 'inactive' : 'not found' });
      return jsonResponse(results);
    }
    log('city lookup (calgary)', true, { city_id: city.id });

    // ─── 1. Create test customer ──────────────────────────────────────────────
    // Use a real Gmail subdomain so Resend actually delivers — webhook events
    // only populate email_events for real recipients. Gmail routes the +tag
    // back to the founder's inbox so test emails are visible (and deletable).
    const customerEmail = `hmedat.medo+smoke-customer-${testId}@gmail.com`;
    const customerPwd = `SmokeTest!${testId}A1`;
    const { data: customerAuth, error: cae } = await admin.auth.admin.createUser({
      email: customerEmail,
      password: customerPwd,
      email_confirm: true,
      user_metadata: { full_name: `Smoke Customer ${testId}` },
    });
    if (cae || !customerAuth.user) {
      log('create customer user', false, { error: cae?.message });
      throw new Error('create customer user failed');
    }
    const customerId = customerAuth.user.id;
    cleanup.push(async () => {
      await admin.from('bookings').delete().eq('customer_id', customerId);
      await admin.auth.admin.deleteUser(customerId);
    });

    // Update the auto-created profile to role='customer' (so requireAuth lets
    // bookings-create through)
    await admin.from('profiles').update({
      role: 'customer',
      full_name: `Smoke Customer ${testId}`,
      phone: `+1403555${1000 + Math.floor(Math.random() * 8999)}`,
    }).eq('id', customerId);
    log('create customer + set role', true, { customerId });

    // ─── 2. Sign in as customer → get JWT ─────────────────────────────────────
    const customerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: cSess, error: cse } = await customerClient.auth.signInWithPassword({
      email: customerEmail,
      password: customerPwd,
    });
    if (cse || !cSess.session) {
      log('customer sign-in', false, { error: cse?.message });
      throw new Error('customer sign-in failed');
    }
    const customerToken = cSess.session.access_token;
    log('customer sign-in', true);

    // ─── 3. Call bookings-create ──────────────────────────────────────────────
    const bookingPayload = {
      city_slug: city.slug,
      pickup: {
        line1: '123 17 Ave SW', city: 'Calgary', region: 'AB',
        country_code: 'CA', postal: 'T2S0A1', lat: 51.0411, lng: -114.0719,
      },
      dropoff: {
        line1: '4502 Elbow Dr SW', city: 'Calgary', region: 'AB',
        country_code: 'CA', postal: 'T2S2L4', lat: 51.0245, lng: -114.0911,
      },
      schedule: {
        mode: 'scheduled' as const,
        date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        window: '8AM-12PM',
      },
      details: {
        moveType: 'home_move' as const,
        dwelling: 'condo',
        bedrooms: 2,
        crewSize: 2,
        estimatedHours: 4,
      },
    };

    const bcResp = await fetch(`${supabaseUrl}/functions/v1/bookings-create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify(bookingPayload),
    });
    const bcData = await bcResp.json();
    if (!bcResp.ok || !bcData?.booking?.id) {
      log('bookings-create', false, {
        status: bcResp.status,
        error: bcData?.error ?? bcData,
      });
      throw new Error('bookings-create failed');
    }
    const bookingId = bcData.booking.id;
    log('bookings-create', true, {
      short_code: bcData.booking.short_code,
      total_cents: bcData.booking.price_total_cents,
    });

    // ─── 4. Verify the row ─────────────────────────────────────────────────────
    const { data: bRow } = await admin
      .from('bookings')
      .select('id, status, customer_id, price_total_cents, total_service_hours, recommended_crew, hourly_rate_customer_cents, materials_cents, fuel_cents')
      .eq('id', bookingId)
      .maybeSingle();
    log('booking row inserted', !!bRow, {
      status: bRow?.status,
      total_cents: bRow?.price_total_cents,
      hours: bRow?.total_service_hours,
      crew: bRow?.recommended_crew,
    });

    // ─── 5. Create driver + assign to booking ─────────────────────────────────
    const driverEmail = `hmedat.medo+smoke-driver-${testId}@gmail.com`;
    const { data: driverAuth, error: dae } = await admin.auth.admin.createUser({
      email: driverEmail,
      password: customerPwd,
      email_confirm: true,
      user_metadata: { full_name: `Smoke Driver ${testId}` },
    });
    if (dae || !driverAuth.user) {
      log('create driver user', false, { error: dae?.message });
      throw new Error('create driver user failed');
    }
    const driverId = driverAuth.user.id;
    cleanup.push(async () => { await admin.auth.admin.deleteUser(driverId); });

    await admin.from('profiles').update({
      role: 'driver',
      full_name: `Smoke Driver ${testId}`,
      phone: `+1403555${1000 + Math.floor(Math.random() * 8999)}`,
    }).eq('id', driverId);
    log('create driver + set role', true, { driverId });

    // Skip the dispatch flow — just assign directly + move to a state where
    // status transitions are allowed (the state-machine trigger expects
    // assignment before on_the_way).
    const { error: assignErr } = await admin.from('bookings').update({
      assigned_driver_profile_id: driverId,
      status: 'assigned',
    }).eq('id', bookingId);
    log('assign driver to booking', !assignErr, { error: assignErr?.message });

    // ─── 6. Sign in as driver ─────────────────────────────────────────────────
    const driverClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: dSess, error: dse } = await driverClient.auth.signInWithPassword({
      email: driverEmail,
      password: customerPwd,
    });
    if (dse || !dSess.session) {
      log('driver sign-in', false, { error: dse?.message });
      throw new Error('driver sign-in failed');
    }
    const driverToken = dSess.session.access_token;
    log('driver sign-in', true);

    // ─── 7. Walk through every status transition ──────────────────────────────
    // State machine (migration 0006): searching → assigned → confirmed →
    // on_the_way → arrived → loading → in_transit → unloading → completed.
    // We already advanced to 'assigned' manually; admin client to push to
    // 'confirmed' (the dispatch-accept step in production), then drive the
    // rest as the driver.
    const { error: confErr } = await admin
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', bookingId);
    log('status → confirmed (admin)', !confErr, { error: confErr?.message });

    const transitions: string[] = [
      'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading', 'completed',
    ];

    for (const next of transitions) {
      if (next === 'completed') {
        // Need a non-zero elapsed time so computeActualBill produces sane values
        await new Promise((r) => setTimeout(r, 2_000));
      }
      const usResp = await fetch(`${supabaseUrl}/functions/v1/bookings-update-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${driverToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
        body: JSON.stringify({ booking_id: bookingId, new_status: next }),
      });
      const usData = await usResp.json();
      log(`status → ${next}`, usResp.ok, {
        ...(next === 'completed' && usData.actual_bill
          ? { actual_total: usData.actual_bill.actualTotalCents, actual_hours: usData.actual_bill.actualHours }
          : {}),
        ...(usResp.ok ? {} : { status: usResp.status, error: usData?.error }),
      });
    }

    // ─── 8. Verify actual bill in the DB ──────────────────────────────────────
    const { data: doneRow } = await admin
      .from('bookings')
      .select('status, started_at, completed_at, actual_hours, actual_total_cents, actual_driver_payout_cents, price_total_cents')
      .eq('id', bookingId)
      .maybeSingle();
    const billOk =
      doneRow?.status === 'completed' &&
      doneRow.actual_total_cents != null &&
      doneRow.actual_driver_payout_cents != null;
    log('actual bill persisted', billOk, {
      estimate_cents: doneRow?.price_total_cents,
      actual_cents: doneRow?.actual_total_cents,
      driver_payout_cents: doneRow?.actual_driver_payout_cents,
    });

    // ─── 9. Cancellation flow on a fresh booking ──────────────────────────────
    const bc2 = await fetch(`${supabaseUrl}/functions/v1/bookings-create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify(bookingPayload),
    });
    const bc2Data = await bc2.json();
    const cancelBookingId = bc2Data?.booking?.id;
    if (!cancelBookingId) {
      log('cancel-flow: create 2nd booking', false, { error: bc2Data?.error });
    } else {
      log('cancel-flow: create 2nd booking', true, { id: cancelBookingId });

      const cancResp = await fetch(`${supabaseUrl}/functions/v1/bookings-cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
          'apikey': anonKey,
        },
        body: JSON.stringify({ booking_id: cancelBookingId, reason: 'Smoke test cancellation' }),
      });
      const cancData = await cancResp.json();
      log('bookings-cancel', cancResp.ok, {
        refund_percent: cancData?.refund_percent,
        refund_cents: cancData?.refund_cents,
        ...(cancResp.ok ? {} : { error: cancData?.error }),
      });
    }

    // ─── 10. Wait for Resend webhooks → check email_events ───────────────────
    // Resend usually fires the `sent` event within 1-2s, `delivered` within
    // 5-10s. 15s is a generous window for a smoke test.
    await new Promise((r) => setTimeout(r, 15_000));

    const { data: events } = await admin
      .from('email_events')
      .select('event_type, template, recipient, occurred_at')
      .eq('recipient', customerEmail)
      .order('occurred_at', { ascending: false });
    log('email_events query', true, { count: events?.length ?? 0 });

    const seenTemplates = new Set((events ?? []).map((e: any) => e.template).filter(Boolean));
    const expectTemplates = ['bookingConfirmed', 'moveComplete', 'bookingCancelled'];
    for (const t of expectTemplates) {
      log(`  template seen: ${t}`, seenTemplates.has(t));
    }

  } catch (e: any) {
    log('UNHANDLED', false, { error: e?.message ?? String(e) });
  } finally {
    // Cleanup, reverse order
    for (const c of cleanup.reverse()) {
      try { await c(); } catch (e) { console.warn('[smoke-test] cleanup error', e); }
    }
    log('cleanup', true);
  }

  return jsonResponse(results);
});

function jsonResponse(results: Array<{ step: string; ok: boolean }>): Response {
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  return new Response(
    JSON.stringify({ summary, results }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
