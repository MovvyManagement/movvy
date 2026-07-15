// =============================================================================
// POST /stripe-webhook   (called by Stripe, not by our apps)
// -----------------------------------------------------------------------------
// Reconciles payment state from Stripe → our DB. Stripe is the source of truth;
// the app never marks a booking "paid" itself. Handles:
//   • payment_intent.succeeded        → booking captured + ledger row
//   • payment_intent.payment_failed   → mark failed
//   • charge.refunded                 → refunded / partially_refunded
//   • charge.dispute.created          → flag disputed (for admin follow-up)
//
// SECURITY:
//   • Verifies the Stripe-Signature header (HMAC-SHA256 over `${t}.${body}`)
//     against STRIPE_WEBHOOK_SECRET. FAIL CLOSED — if the secret is unset or
//     the signature is wrong/stale, we reject. A spoofed webhook must never be
//     able to mark a move paid.
//   • 5-minute timestamp tolerance to block replay.
//   • Deployed with verify_jwt = false (Stripe has no Supabase JWT) — the
//     signature IS the auth.
//   • Writes with the service role, so it can update bookings/payments past
//     RLS — but only ever after the signature check passes.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendBrandedEmail } from '../_shared/email.ts';
import { bookingConfirmed } from '../_shared/emails/index.ts';
import { fmtAddress, fmtDateTime, fmtMoney, fmtTimeWindow, startHourFromWindow } from '../_shared/format.ts';

const SIG_TOLERANCE_S = 300; // 5 minutes

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Verify Stripe's signature scheme. Header looks like: `t=169..,v1=abc..,v0=..`
async function verify(rawBody: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > SIG_TOLERANCE_S) return false; // replay guard

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  return timingSafeEqual(hex(mac), v1);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    // FAIL CLOSED — no secret means we cannot trust anything. Reject loudly.
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET unset — rejecting');
    return new Response('Webhook not configured', { status: 503 });
  }

  const rawBody = await req.text();
  const ok = await verify(rawBody, req.headers.get('Stripe-Signature'), secret);
  if (!ok) {
    console.warn('[stripe-webhook] signature verification failed');
    return new Response('Invalid signature', { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const upsertPayment = async (row: Record<string, unknown>) => {
    await admin.from('payments').upsert(row, { onConflict: 'stripe_payment_intent_id' });
  };

  try {
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const bookingId = obj.metadata?.booking_id ?? null;
        const kind = obj.metadata?.kind === 'deposit' ? 'deposit' : 'final';
        const amount = obj.amount_received ?? obj.amount ?? 0;
        // Tip travels in PI metadata (set by stripe-create-payment-intent). It's
        // 100% the crew's, so we store it separately for the admin payout math.
        const tipCents = Number(obj.metadata?.tip_cents ?? 0) || 0;
        const chargeId = obj.latest_charge ?? null;
        if (bookingId) {
          if (kind === 'deposit') {
            // Deposit paid — the booking's FINAL payment_status is untouched;
            // the deposit has its own lifecycle.
            await admin.from('bookings').update({
              deposit_status: 'paid',
              deposit_cents: amount,
              deposit_paid_at: new Date().toISOString(),
              stripe_deposit_payment_intent_id: obj.id,
            }).eq('id', bookingId);

            // DISPATCH: the deposit is what makes a booking real. Atomically
            // flip draft → searching (the .eq('status','draft') guard makes
            // Stripe's at-least-once redeliveries a no-op), then — only if WE
            // did the flip — announce the job to crews and send the customer
            // their booking-confirmed email. Both moved here from
            // bookings-create so nobody hears about an unpaid booking.
            const { data: dispatched } = await admin.from('bookings')
              .update({ status: 'searching' })
              .eq('id', bookingId)
              .eq('status', 'draft')
              .select('id, short_code, city_id, move_type, pickup_line1, pickup_city, dropoff_line1, dropoff_city, scheduled_for_date, scheduled_for_window, price_total_cents, pricing_breakdown, customer_id')
              .maybeSingle();

            if (dispatched) {
              const bk = dispatched as any;
              // Crew broadcast — best-effort, never blocks the 200 to Stripe.
              try {
                const driverDollars = Math.round(
                  Number(bk.pricing_breakdown?.driverTotalCents ?? bk.price_total_cents * 0.8) / 100,
                );
                const [teamRes, companyRes] = await Promise.all([
                  admin
                    .from('partner_team_members')
                    .select('profile_id, partner_teams!inner(primary_city_id, onboarding_status)')
                    .eq('partner_teams.primary_city_id', bk.city_id)
                    .eq('partner_teams.onboarding_status', 'verified')
                    .eq('status', 'active')
                    .is('removed_at', null),
                  admin
                    .from('company_members')
                    .select('profile_id, role, companies!inner(primary_city_id, onboarding_status)')
                    .eq('companies.primary_city_id', bk.city_id)
                    .eq('companies.onboarding_status', 'verified')
                    .in('role', ['owner', 'dispatcher'])
                    .eq('status', 'active')
                    .is('removed_at', null),
                ]);
                const recipients = new Set<string>();
                for (const r of teamRes.data ?? []) recipients.add((r as any).profile_id);
                for (const r of companyRes.data ?? []) recipients.add((r as any).profile_id);
                if (recipients.size > 0) {
                  await admin.from('notifications').insert(
                    Array.from(recipients).map((profile_id) => ({
                      profile_id,
                      channel: 'in_app' as const,
                      category: 'job.available',
                      title: 'New job available',
                      body: `${bk.pickup_city} → ${bk.dropoff_city ?? 'in-home'} · est. $${driverDollars} payout`,
                      data: { booking_id: bk.id, short_code: bk.short_code, move_type: bk.move_type },
                    })),
                  );
                }
              } catch (e) {
                console.warn('[stripe-webhook] partner broadcast failed (non-fatal)', e);
              }

              // Booking-confirmed email — now honest: deposit is in hand.
              try {
                const { data: profile } = await admin
                  .from('profiles').select('email, full_name').eq('id', bk.customer_id).maybeSingle();
                if (profile?.email) {
                  const startHour = startHourFromWindow(bk.scheduled_for_window);
                  sendBrandedEmail({
                    to: profile.email,
                    template: bookingConfirmed({
                      fullName: profile.full_name,
                      shortCode: bk.short_code,
                      pickupAddress: fmtAddress(bk.pickup_line1, bk.pickup_city),
                      dropoffAddress: bk.dropoff_line1
                        ? fmtAddress(bk.dropoff_line1, bk.dropoff_city)
                        : 'In-home / labor only',
                      scheduledStart: fmtDateTime(bk.scheduled_for_date, startHour),
                      scheduledWindow: fmtTimeWindow(bk.scheduled_for_window),
                      crewSize: Number(bk.pricing_breakdown?.recommendedCrew ?? 2),
                      estimatedTotalDollars: fmtMoney(bk.price_total_cents),
                      bookingUrl: `https://movvy.ca/app/bookings/${bk.id}`,
                    }),
                  }).catch((e) => console.warn('[stripe-webhook] confirm email failed', e));
                }
              } catch (e) {
                console.warn('[stripe-webhook] confirm email setup failed (non-fatal)', e);
              }
            }
          } else {
            const depositApplied = Number(obj.metadata?.deposit_applied_cents ?? 0) || 0;
            await admin.from('bookings').update({
              payment_status: 'captured',
              // Total collected for the move = this charge + the deposit that
              // was credited against it (tip excluded — it's the crew's).
              amount_paid_cents: amount - tipCents + depositApplied,
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: obj.id,
            }).eq('id', bookingId);
          }
        }
        await upsertPayment({
          booking_id: bookingId,
          customer_id: obj.metadata?.customer_id ?? null,
          stripe_payment_intent_id: obj.id,
          stripe_charge_id: chargeId,
          amount_cents: amount,
          tip_cents: tipCents,
          kind,
          currency: obj.currency ?? 'cad',
          status: 'succeeded',
          raw_event_type: event.type,
        });
        break;
      }
      case 'payment_intent.payment_failed': {
        const bookingId = obj.metadata?.booking_id ?? null;
        const kind = obj.metadata?.kind === 'deposit' ? 'deposit' : 'final';
        // A failed DEPOSIT attempt never touches the booking's final
        // payment_status — the customer just retries from the app.
        if (bookingId && kind === 'final') {
          await admin.from('bookings').update({ payment_status: 'failed' }).eq('id', bookingId);
        }
        await upsertPayment({
          booking_id: bookingId,
          customer_id: obj.metadata?.customer_id ?? null,
          stripe_payment_intent_id: obj.id,
          amount_cents: obj.amount ?? 0,
          kind,
          currency: obj.currency ?? 'cad',
          status: 'failed',
          raw_event_type: event.type,
        });
        break;
      }
      case 'charge.refunded': {
        const piId = obj.payment_intent ?? null;
        const refunded = obj.amount_refunded ?? 0;
        const total = obj.amount ?? 0;
        const fully = refunded >= total && total > 0;
        if (piId) {
          // Final-payment refund → flips the booking's payment_status.
          const { data: bk } = await admin.from('bookings')
            .select('id').eq('stripe_payment_intent_id', piId).maybeSingle();
          if (bk) {
            await admin.from('bookings')
              .update({ payment_status: fully ? 'refunded' : 'partially_refunded' })
              .eq('id', (bk as any).id);
          }
          // Deposit refund (>48h cancellation) → flips deposit_status instead.
          const { data: depBk } = await admin.from('bookings')
            .select('id').eq('stripe_deposit_payment_intent_id', piId).maybeSingle();
          if (depBk && fully) {
            await admin.from('bookings')
              .update({ deposit_status: 'refunded' })
              .eq('id', (depBk as any).id);
          }
          await admin.from('payments').update({
            status: fully ? 'refunded' : 'partially_refunded',
            refunded_cents: refunded,
            raw_event_type: event.type,
          }).eq('stripe_payment_intent_id', piId);
        }
        break;
      }
      case 'charge.dispute.created': {
        const piId = obj.payment_intent ?? null;
        if (piId) {
          await admin.from('payments').update({
            status: 'disputed', raw_event_type: event.type,
          }).eq('stripe_payment_intent_id', piId);
        }
        break;
      }
      default:
        // Unhandled event types are fine — acknowledge so Stripe stops retrying.
        break;
    }
  } catch (e) {
    // Log but still 200: a DB hiccup shouldn't make Stripe hammer us with
    // retries. We reconcile from the dashboard if anything is ever missed.
    console.error('[stripe-webhook] handler error', event?.type, e);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
