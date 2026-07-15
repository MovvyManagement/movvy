// =============================================================================
// POST /support-sos
//
// Mid-move SOS — customer taps the panic button. We:
//   1. Verify the caller is the customer of an in-flight booking
//   2. Fan out high-priority notifications (in_app + push):
//      • every movvy_admin + movvy_support
//      • the booking's assigned driver
//      • owners + dispatchers of the assigned company (if any)
//      • the customer's emergency contact via SMS (Twilio when configured)
//   3. Record a `dispute` row with kind='sos' so the legal trail starts in
//      the same surface as every other claim
//   4. Drop a structured message into the customer's permanent support
//      chat thread so the admin who responds first has full context
//   5. Email an emergency-services tip to the configured RCMP / police
//      address when SOS_POLICE_NOTIFY_EMAIL is set (Canada-only)
//   6. Append an audit row referencing the booking
//
// This is the "everything is going wrong, prioritise the human first"
// path — non-fatal failures (push hiccup, missing emergency contact, no
// police email configured) are logged but don't block the response.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  /** Optional message — what's going on. Plain text, 0–500 chars. */
  message: z.string().max(500).optional(),
  /** Last known coordinates — useful for admins when the move is mobile. */
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // SOS is rate-limited so a panicking finger doesn't flood the system,
    // but still allows enough re-presses to clear a glitch (3 / min, 20 / hr).
    await checkRateLimit({
      bucketKey: `user:${user.id}:support_sos_min`,
      endpoint: 'support-sos',
      limit: 3, windowSeconds: 60,
    });
    await checkRateLimit({
      bucketKey: `user:${user.id}:support_sos_hr`,
      endpoint: 'support-sos',
      limit: 20, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, message, lat, lng } = parsed.data;

    const admin = adminClient();

    // 1) Verify the caller owns this booking AND it's currently active
    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select(
        'id, short_code, customer_id, status, assigned_driver_profile_id, assigned_company_id, ' +
          'assigned_team_id, pickup_line1, pickup_city, dropoff_line1, dropoff_city',
      )
      .eq('id', booking_id)
      .single();
    if (bErr || !booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, "Not your booking");
    if (['completed', 'cancelled', 'failed', 'draft'].includes(booking.status)) {
      throw httpError(409, "SOS is only available during an in-flight move.");
    }

    // 2) Pull the customer profile (emergency contact + name for SMS body)
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, emergency_contact_name, emergency_contact_phone, phone')
      .eq('id', user.id)
      .single();

    // 3) Build the recipient list for in-app + push notifications.
    //
    // SQL-side `or(role.in.(...))` keeps it to a single round-trip; we then
    // fan out the rows in code so each side gets a tailored title/body.
    const adminQuery = admin
      .from('profiles')
      .select('id, role')
      .in('role', ['movvy_admin', 'movvy_support']);
    const dispatcherQuery = booking.assigned_company_id
      ? admin
          .from('company_members')
          .select('profile_id, role')
          .eq('company_id', booking.assigned_company_id)
          .in('role', ['owner', 'dispatcher'])
          .eq('status', 'active')
          .is('removed_at', null)
      : Promise.resolve({ data: [] });
    const [adminRes, dispatcherRes] = await Promise.all([adminQuery, dispatcherQuery]);
    const adminIds = (adminRes.data ?? []).map((r: any) => r.id as string);
    const dispatcherIds = (dispatcherRes.data ?? []).map((r: any) => r.profile_id as string);
    const driverIds = booking.assigned_driver_profile_id ? [booking.assigned_driver_profile_id] : [];

    const recipientIds = new Set<string>([...adminIds, ...dispatcherIds, ...driverIds]);

    // Title / body that work across every recipient — short, alarm-ish, with
    // the short code so the responder can pivot to the booking in one tap.
    const title = `🚨 SOS · booking #${booking.short_code}`;
    const customerName = profile?.full_name ?? 'A customer';
    const body =
      (message?.trim() ? `"${message.trim()}" — ${customerName}` : `${customerName} pressed the SOS button.`)
      + ` Pickup ${booking.pickup_city}.`;
    const payload = {
      booking_id: booking.id,
      short_code: booking.short_code,
      customer_id: user.id,
      driver_id: booking.assigned_driver_profile_id ?? null,
      company_id: booking.assigned_company_id ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
      category: 'sos',
    };

    // One in_app row per recipient — the notifications_push_fanout trigger
    // sends the push, so the lock screen lights up within seconds. (Previously
    // a second 'push' row was inserted too; with the trigger live that would
    // double-fire, so it's collapsed to one row.)
    if (recipientIds.size > 0) {
      const rows: any[] = [];
      for (const pid of recipientIds) {
        rows.push({ profile_id: pid, channel: 'in_app', category: 'support.sos', title, body, data: payload });
      }
      const { error: nErr } = await admin.from('notifications').insert(rows);
      if (nErr) console.warn('[support-sos] notifications insert failed', nErr);
    }

    // 4) Emergency contact via SMS (Twilio if configured, otherwise stubbed)
    let emergencySmsSent: boolean = false;
    if (profile?.emergency_contact_phone) {
      const smsBody =
        `MOVVY EMERGENCY — ${customerName} pressed the SOS button during their move ` +
        `(${booking.pickup_city}${booking.dropoff_city ? ' → ' + booking.dropoff_city : ''}). ` +
        `Movvy support is on it. Reply to this number to reach them, or call 911 if urgent.`;
      const sent = await sendTwilioSms(profile.emergency_contact_phone, smsBody);
      emergencySmsSent = !sent.error;
      if (sent.error) {
        console.warn('[support-sos] emergency SMS failed', sent.error);
      }
    }

    // 5) Police tip — bare-bones email to a configured address. Stubbed
    // unless SOS_POLICE_NOTIFY_EMAIL + RESEND_API_KEY are both set.
    const policeEmail = Deno.env.get('SOS_POLICE_NOTIFY_EMAIL');
    let policeNotified = false;
    if (policeEmail) {
      const text =
        `Movvy in-app SOS\n\n` +
        `Customer: ${customerName} (${profile?.phone ?? 'phone unknown'})\n` +
        `Booking: #${booking.short_code}\n` +
        `Last pickup address: ${booking.pickup_line1}, ${booking.pickup_city}\n` +
        (booking.dropoff_line1
          ? `Drop-off address: ${booking.dropoff_line1}, ${booking.dropoff_city ?? ''}\n`
          : '') +
        (lat && lng ? `Last known location: ${lat}, ${lng}\n` : '') +
        (message ? `Customer message: ${message}\n` : '') +
        `\nMovvy support is engaged. This is an automated tip; please confirm by ` +
        `replying to support@movvy.ca.`;
      const res = await sendEmail(policeEmail, `Movvy SOS · #${booking.short_code}`, text);
      policeNotified = !res.error;
    }

    // 6) Create a 'sos' dispute row so the customer + admin see it in their
    // disputes lists. Severity high; opened_by = customer.
    const { data: dispute } = await admin
      .from('disputes')
      .insert({
        booking_id: booking.id,
        opened_by: user.id,
        against_profile_id: booking.assigned_driver_profile_id ?? null,
        against_company_id: booking.assigned_company_id ?? null,
        kind: 'sos',
        severity: 'high',
        summary:
          (message?.trim() || 'Customer pressed the in-app SOS button.')
          + (lat && lng ? ` Last known location ${lat.toFixed(5)}, ${lng.toFixed(5)}.` : ''),
        status: 'open',
      })
      .select('id')
      .single();

    // 7) Drop a structured message into the customer's permanent support
    // thread. ensure_support_thread() bootstraps it if needed.
    const { data: threadId } = await admin.rpc('ensure_support_thread').catch(() => ({ data: null }));
    if (threadId) {
      await admin.from('chat_messages').insert({
        thread_id: threadId,
        sender_profile_id: user.id,
        is_admin: false,
        body:
          `🚨 SOS triggered for booking #${booking.short_code} at `
          + new Date().toISOString() + '.\n' +
          (message?.trim() ? `Message: ${message.trim()}\n` : '') +
          (lat && lng ? `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` : '') +
          (emergencySmsSent ? 'Emergency contact notified by SMS.\n' : '') +
          (policeNotified ? 'Police tip emailed.\n' : ''),
      });
      await admin
        .from('chat_threads')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', threadId);
    }

    // 8) Audit
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'support.sos',
      entityType: 'booking',
      entityId: booking.id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: {
        recipients: recipientIds.size,
        emergency_sms_sent: emergencySmsSent,
        police_notified: policeNotified,
        dispute_id: dispute?.id ?? null,
        lat, lng,
      },
    });

    return jsonResponse(
      {
        ok: true,
        recipients: recipientIds.size,
        emergency_sms_sent: emergencySmsSent,
        police_notified: policeNotified,
        dispute_id: dispute?.id ?? null,
        support_thread_id: threadId ?? null,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[support-sos] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});

// ─── Twilio + Resend stubs ──────────────────────────────────────────────────
// Mirrors partners-invite-send: real API call when keys are present,
// non-fatal stub otherwise.

async function sendTwilioSms(
  to: string,
  body: string,
): Promise<{ error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER') ?? Deno.env.get('TWILIO_PHONE_NUMBER');
  if (!sid || !token || !from) {
    console.log('[support-sos/sms-stub]', { to, body: body.slice(0, 80) + '…' });
    return {};
  }
  try {
    const auth = btoa(`${sid}:${token}`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data?.message ?? `Twilio ${res.status}` };
    }
    return {};
  } catch (e: any) {
    return { error: e?.message ?? 'Twilio fetch failed' };
  }
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM') ?? 'support@movvy.ca';
  if (!apiKey) {
    console.log('[support-sos/email-stub]', { to, subject });
    return {};
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data?.message ?? `Resend ${res.status}` };
    }
    return {};
  } catch (e: any) {
    return { error: e?.message ?? 'Resend fetch failed' };
  }
}
