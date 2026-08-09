// =============================================================================
// usePayForMove — drives the Stripe Payment Sheet for paying for a completed
// move (customer → Movvy, direct charge).
//
// Flow:
//   1. Ask our backend to create a PaymentIntent for this booking. The amount
//      is computed SERVER-SIDE (stripe-create-payment-intent) — we never send
//      or trust a client amount here.
//   2. initPaymentSheet with the returned client_secret.
//   3. presentPaymentSheet — card entry only; the wallets are off by design
//      (see the initPaymentSheet call for why).
//   4. On success, the stripe-webhook marks the booking paid; we just report
//      success so the UI can update optimistically.
//
// Returns a discriminated result so callers can distinguish a real failure
// from the user simply dismissing the sheet.
// =============================================================================

import { useState } from 'react';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '@/lib/supabase';

export type PayResult =
  | { status: 'paid'; amountCents: number }
  | { status: 'settled' }          // nothing left to charge (deposit covered it)
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export type PayKind = 'deposit' | 'final';

export function usePayForMove() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isPaying, setIsPaying] = useState(false);

  async function pay(bookingId: string, tipCents = 0, kind: PayKind = 'final'): Promise<PayResult> {
    setIsPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-create-payment-intent',
        { body: { booking_id: bookingId, kind, tip_cents: Math.max(0, Math.round(tipCents)) } },
      );
      if (error) throw new Error(error.message ?? 'Could not start the payment.');
      if ((data as any)?.error) throw new Error((data as any).error);
      // Deposit covered the whole bill — nothing to present, already settled.
      if ((data as any)?.settled) return { status: 'settled' };

      const clientSecret = (data as any).client_secret as string;
      const amountCents = (data as any).amount_cents as number;
      if (!clientSecret) throw new Error('Payment could not be started.');

      const init = await initPaymentSheet({
        merchantDisplayName: 'Movvy',
        paymentIntentClientSecret: clientSecret,
        // Return URL lets redirect-based methods come back to the app. Matches
        // the `movvy` scheme registered in app.json.
        returnURL: 'movvy://stripe-redirect',
        // Card only — no Apple Pay, no Google Pay. Both are deliberately off:
        // Apple Pay needs a merchant ID and the in-app-payments entitlement on
        // a paid Apple account, and Google Pay was configured with
        // `testEnv: true`, which would have sent real production checkouts to
        // Google's test environment and collected nothing. Rather than ship a
        // wallet button that silently fails, Movvy takes cards.
      });
      if (init.error) throw new Error(init.error.message);

      const res = await presentPaymentSheet();
      if (res.error) {
        // "Canceled" = the user dismissed the sheet; not an error to surface.
        if (res.error.code === 'Canceled') return { status: 'canceled' };
        return { status: 'error', message: res.error.message };
      }
      return { status: 'paid', amountCents };
    } catch (e: any) {
      return { status: 'error', message: e?.message ?? 'Payment failed. Please try again.' };
    } finally {
      setIsPaying(false);
    }
  }

  return { pay, isPaying };
}
