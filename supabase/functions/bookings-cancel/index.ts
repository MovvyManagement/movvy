// POST /bookings-cancel
// Customer cancels a booking. Refund eligibility computed server-side based on
// how close to scheduled time the cancellation comes.
//
// DEPOSIT POLICY (Adam, 2026-07-07 — replaces the old 100/80/50/0 tiers):
//   The 20% booking deposit is refunded IN FULL if the cancellation happens
//   MORE than 48 hours before the scheduled start. At ≤48h it is forfeited
//   (compensates the crew that held the slot). The refund is a real Stripe
//   refund against the deposit PaymentIntent; the signature-verified webhook
//   confirms it (charge.refunded → deposit_status='refunded').

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

// Deposit refundable only with more than 48 hours' notice (47h59m = forfeited).
const REFUND_CUTOFF_HOURS = 48;

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
      .select('id, short_code, customer_id, status, scheduled_for_window_starts_at, scheduled_for_date, price_total_cents, assigned_team_id, assigned_company_id, assigned_driver_profile_id, deposit_cents, deposit_status, stripe_deposit_payment_intent_id')
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

    // Deposit refund eligibility: strictly more than 48h notice (admins can
    // always refund as a goodwill override).
    const scheduled = booking.scheduled_for_window_starts_at
      ? new Date(booking.scheduled_for_window_starts_at)
      : new Date(booking.scheduled_for_date + 'T08:00:00Z');
    const hoursUntil = (scheduled.getTime() - Date.now()) / 3_600_000;
    const depositPaid = booking.deposit_status === 'paid' && (booking.deposit_cents ?? 0) > 0;
    const depositRefundable = isAdmin || hoursUntil > REFUND_CUTOFF_HOURS;
    const refundPct = depositRefundable ? 100 : 0;
    const refundCents = depositPaid && depositRefundable ? (booking.deposit_cents ?? 0) : 0;

    // Update via the ADMIN client. Ownership was already verified above, and
    // the customer's RLS UPDATE policy silently filters out a booking once a
    // company is assigned — so a user-scoped update matched 0 ROWS and returned
    // NO error, making the cancel "succeed" without changing anything (the move
    // then lingered on the customer's live tracker AND the company/driver
    // queues, where it could still be worked). The status-transition trigger
    // still gates the change (assigned/confirmed → cancelled is allowed).
    // `.eq('status', booking.status)` guards a concurrent change, and `.select()`
    // proves a row actually flipped so we never report a phantom success again.
    const { data: updatedRows, error: updateErr } = await admin
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        cancelled_by: user.id,
      })
      .eq('id', booking_id)
      .eq('status', booking.status)
      .select('id');

    if (updateErr) throw httpError(400, updateErr.message);
    if (!updatedRows || updatedRows.length === 0) {
      throw httpError(409, 'Move could not be cancelled — it may have just changed status. Pull to refresh and try again.');
    }

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

    // Notify the assigned crew. A customer cancel previously just made the
    // job vanish from the driver's Active screen with no explanation — a crew
    // already driving to pickup got zero signal. Only fires when someone was
    // actually assigned (a still-searching booking has no crew to tell).
    // Fire-and-forget: an inbox hiccup never blocks the cancel response.
    try {
      const recipients = new Set<string>();
      if (booking.assigned_driver_profile_id) {
        recipients.add(booking.assigned_driver_profile_id);
      }
      if (booking.assigned_team_id) {
        // Whole crew — operator + hourly movers riding along need to know.
        const { data: members } = await admin
          .from('partner_team_members')
          .select('profile_id')
          .eq('team_id', booking.assigned_team_id)
          .eq('status', 'active')
          .is('removed_at', null);
        for (const m of members ?? []) recipients.add((m as any).profile_id);
      }
      if (booking.assigned_company_id) {
        // Owner/dispatcher — so they can free or reassign the slot.
        const { data: members } = await admin
          .from('company_members')
          .select('profile_id')
          .eq('company_id', booking.assigned_company_id)
          .in('role', ['owner', 'dispatcher'])
          .eq('status', 'active')
          .is('removed_at', null);
        for (const m of members ?? []) recipients.add((m as any).profile_id);
      }
      recipients.delete(user.id); // never notify whoever pressed cancel

      if (recipients.size > 0) {
        const shortCode = (booking as any).short_code ?? booking.id.slice(0, 8).toUpperCase();
        const byPhrase = isAdmin ? 'by Movvy' : 'by the customer';
        const rows = Array.from(recipients).map((profile_id) => ({
          profile_id,
          channel: 'in_app' as const,
          category: 'booking.cancelled',
          title: 'Move cancelled',
          body: `Booking #${shortCode} on ${fmtDateShort(booking.scheduled_for_date)} was cancelled ${byPhrase}. The slot is now free.`,
          data: { booking_id: booking.id, short_code: shortCode, cancelled_by: isAdmin ? 'movvy' : 'customer' },
        }));
        await admin.from('notifications').insert(rows);
      }
    } catch (notifyErr) {
      console.warn('[bookings-cancel] crew notify failed (non-fatal)', notifyErr);
    }

    // ─── Deposit settlement ────────────────────────────────────────────────
    // >48h notice → real Stripe refund of the deposit (webhook confirms and
    // flips deposit_status to 'refunded'). ≤48h → forfeited immediately.
    // A refund API failure never blocks the cancel — we log + leave the
    // deposit 'paid' so the admin Payments page shows it for manual follow-up.
    if (depositPaid) {
      if (depositRefundable && booking.stripe_deposit_payment_intent_id) {
        const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (secretKey) {
          try {
            const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Idempotency-Key': `movvy_dep_refund_${booking.id}`,
              },
              body: `payment_intent=${encodeURIComponent(booking.stripe_deposit_payment_intent_id)}`,
            });
            if (!refundRes.ok) {
              console.error('[bookings-cancel] deposit refund failed', refundRes.status, await refundRes.text());
            }
          } catch (refundErr) {
            console.error('[bookings-cancel] deposit refund error', refundErr);
          }
        } else {
          console.error('[bookings-cancel] STRIPE_SECRET_KEY unset — deposit refund needs manual follow-up');
        }
      } else if (!depositRefundable) {
        await admin.from('bookings')
          .update({ deposit_status: 'forfeited' })
          .eq('id', booking.id);
      }
    }

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
