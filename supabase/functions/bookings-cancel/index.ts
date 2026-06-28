// POST /bookings-cancel
// Customer cancels a booking. Refund eligibility computed server-side based on
// how close to scheduled time the cancellation comes.
//
// Cancellation policy (placeholder until you provide the official one):
//   > 48h before scheduled → full refund
//   24-48h before          → 80% refund
//   2-24h before           → 50% refund
//   < 2h before / completed → no refund (driver paid)

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { bookingCancelled } from '../_shared/emails/index.ts';
import { fmtDateShort, fmtMoney } from '../_shared/format.ts';

const Body = z.object({
  booking_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

function refundPercent(hoursUntil: number): number {
  if (hoursUntil > 48) return 100;
  if (hoursUntil > 24) return 80;
  if (hoursUntil > 2) return 50;
  return 0;
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:bookings_cancel`,
      endpoint: 'bookings-cancel',
      limit: 10,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { booking_id, reason } = parsed.data;

    const admin = adminClient();

    // Load the booking — admin client bypasses RLS so we can read for ownership check
    const { data: booking, error: loadErr } = await admin
      .from('bookings')
      .select('id, short_code, customer_id, status, scheduled_for_window_starts_at, scheduled_for_date, price_total_cents, assigned_team_id, assigned_company_id')
      .eq('id', booking_id)
      .single();

    if (loadErr || !booking) throw httpError(404, 'Booking not found');

    // Ownership check: customer can cancel their own, admin can cancel any
    const isOwner = booking.customer_id === user.id;
    const isAdmin = user.role === 'movvy_admin' || user.role === 'movvy_support';
    if (!isOwner && !isAdmin) throw httpError(403, 'Cannot cancel another user\'s booking');

    if (['completed', 'cancelled', 'failed'].includes(booking.status)) {
      throw httpError(400, `Booking is already ${booking.status}`);
    }

    // Compute refund based on time-until-move
    const scheduled = booking.scheduled_for_window_starts_at
      ? new Date(booking.scheduled_for_window_starts_at)
      : new Date(booking.scheduled_for_date + 'T08:00:00Z');
    const hoursUntil = (scheduled.getTime() - Date.now()) / 3_600_000;
    const refundPct = isAdmin ? 100 : refundPercent(hoursUntil);
    const refundCents = Math.round((booking.price_total_cents * refundPct) / 100);

    // Update through user-scoped client so RLS applies for non-admins
    const supabase = userClient(req.headers.get('Authorization'));
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        cancelled_by: user.id,
      })
      .eq('id', booking_id);

    if (updateErr) throw httpError(400, updateErr.message);

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.cancelled',
      entityType: 'booking',
      entityId: booking_id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { reason, refund_percent: refundPct, refund_cents: refundCents, hours_until: hoursUntil },
    });

    // Stripe refund is issued in a later phase — for now we just record the eligible amount.
    // TODO: enqueue refund job once Stripe Connect is wired in Phase 3.

    // Branded cancellation email — fire-and-forget so a Resend hiccup
    // never blocks the cancel response.
    try {
      const { data: customer } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('id', booking.customer_id)
        .maybeSingle();
      if (customer?.email) {
        sendBrandedEmail({
          to: customer.email,
          template: bookingCancelled({
            fullName: customer.full_name,
            shortCode: (booking as any).short_code ?? booking.id.slice(0, 8).toUpperCase(),
            scheduledStart: fmtDateShort(booking.scheduled_for_date),
            cancelledBy: isAdmin ? 'movvy' : 'customer',
            reason,
            refundedAmount: fmtMoney(refundCents),
            rebookUrl: 'https://movvy.ca/app/book',
          }),
        }).catch((e) => console.warn('[bookings-cancel] email send failed', e));
      }
    } catch (emailErr) {
      console.warn('[bookings-cancel] email setup failed (non-fatal)', emailErr);
    }

    return jsonResponse(
      { ok: true, refund_percent: refundPct, refund_cents: refundCents },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[bookings-cancel] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
