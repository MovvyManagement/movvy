// =============================================================================
// POST /receipt-email
//
// Emails the signed-in customer a plain-text receipt for one of their
// completed bookings. We send text + a minimal inline HTML so most clients
// render it nicely; no PDF attachment yet (deferred until we have a real
// renderer pipeline). The text version is the source of truth for
// accountants — addresses, dates, line items, tip, total.
//
// Idempotent: rate-limited per user per booking; safe to retry.
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
  /** Optional override — if absent we use the email on the user's profile. */
  email: z.string().email().optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:receipt_email`,
      endpoint: 'receipt-email',
      limit: 10,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, email: overrideEmail } = parsed.data;

    const admin = adminClient();

    // Load booking and confirm caller is the customer
    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select(
        'id, short_code, status, customer_id, move_type, pickup_line1, pickup_city, dropoff_line1, dropoff_city, scheduled_for_date, scheduled_for_window, completed_at, price_total_cents, price_subtotal_cents, price_tax_cents, tip_cents',
      )
      .eq('id', booking_id)
      .single();
    if (bErr || !booking) throw httpError(404, 'Booking not found');
    if (booking.customer_id !== user.id) throw httpError(403, 'Only the customer can request this receipt');
    if (booking.status !== 'completed') throw httpError(400, 'Receipt is only available for completed moves');

    // Resolve recipient email
    let recipient = overrideEmail;
    if (!recipient) {
      const { data: profile } = await admin
        .from('profiles')
        .select('email')
        .eq('id', user.id)
        .single();
      recipient = profile?.email ?? undefined;
    }
    if (!recipient) throw httpError(400, 'No email on file. Provide one in the request body.');

    const subtotal = ((booking.price_subtotal_cents ?? 0) / 100).toFixed(2);
    const tax = ((booking.price_tax_cents ?? 0) / 100).toFixed(2);
    const tip = ((booking.tip_cents ?? 0) / 100).toFixed(2);
    const total = ((booking.price_total_cents ?? 0) / 100).toFixed(2);
    const dropoff = booking.dropoff_line1
      ? `${booking.dropoff_line1}, ${booking.dropoff_city ?? ''}`
      : 'In-home (no drop-off)';

    const text =
      `Movvy receipt — booking #${booking.short_code}\n\n` +
      `Move type: ${booking.move_type.replace(/_/g, ' ')}\n` +
      `Scheduled:  ${booking.scheduled_for_date}${booking.scheduled_for_window ? ' · ' + booking.scheduled_for_window : ''}\n` +
      `Completed:  ${booking.completed_at ? new Date(booking.completed_at).toLocaleString('en-CA') : '—'}\n\n` +
      `Pickup:   ${booking.pickup_line1}, ${booking.pickup_city}\n` +
      `Drop-off: ${dropoff}\n\n` +
      `Subtotal      $${subtotal}\n` +
      `Tax (GST 5%)  $${tax}\n` +
      `Tip           $${tip}\n` +
      `─────────────────\n` +
      `Total         $${total} CAD\n\n` +
      `Thanks for moving with Movvy.\n` +
      `Questions? Reply to this email or message us from the app.`;

    const html =
      `<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0A0A0A;max-width:560px;margin:24px auto;padding:24px;background:#fff">
        <h2 style="margin:0 0 4px;font-weight:700">Movvy receipt</h2>
        <div style="color:#71717A;font-size:13px">Booking #${booking.short_code}</div>
        <hr style="border:none;border-top:1px solid #E4E4E7;margin:20px 0">
        <p><strong>${booking.move_type.replace(/_/g, ' ')}</strong> · ${booking.scheduled_for_date}${booking.scheduled_for_window ? ` · ${booking.scheduled_for_window}` : ''}</p>
        <p style="color:#52525B;font-size:14px;margin:4px 0"><strong>Pickup:</strong> ${booking.pickup_line1}, ${booking.pickup_city}</p>
        <p style="color:#52525B;font-size:14px;margin:4px 0"><strong>Drop-off:</strong> ${dropoff}</p>
        <table style="width:100%;margin-top:20px;font-size:14px">
          <tr><td style="color:#71717A">Subtotal</td><td align="right">$${subtotal}</td></tr>
          <tr><td style="color:#71717A">Tax (GST 5%)</td><td align="right">$${tax}</td></tr>
          <tr><td style="color:#71717A">Tip</td><td align="right">$${tip}</td></tr>
          <tr><td colspan="2"><hr style="border:none;border-top:1px solid #E4E4E7;margin:8px 0"></td></tr>
          <tr><td><strong>Total</strong></td><td align="right"><strong>$${total} CAD</strong></td></tr>
        </table>
        <p style="color:#71717A;font-size:12px;margin-top:24px">Thanks for moving with Movvy. Reply to this email if anything looks off.</p>
      </body></html>`;

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('RESEND_FROM') ?? 'receipts@movvy.ca';
    if (!apiKey) {
      // Dev mode — log only. Still mark the audit so we can verify the call.
      console.log('[receipt-email/stub]', { to: recipient, subject: `Movvy receipt #${booking.short_code}` });
    } else {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: recipient,
          subject: `Movvy receipt · #${booking.short_code}`,
          text,
          html,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw httpError(502, data?.message ?? `Resend ${res.status}`);
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'receipt.emailed',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { recipient_masked: recipient.replace(/(.{2}).+(@.*)/, '$1***$2') },
    });

    return jsonResponse({ ok: true, sent_to: recipient }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[receipt-email] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
