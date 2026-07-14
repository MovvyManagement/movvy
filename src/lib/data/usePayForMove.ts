// =============================================================================
// usePayForMove — drives the Stripe Payment Sheet for paying for a completed
// move (customer → Movvy, direct charge).
//
// Flow:
//   1. Ask our backend to create a PaymentIntent for this booking. The amount
//      is computed SERVER-SIDE (stripe-create-payment-intent) — we never send
//      or trust a client amount here.
//   2. initPaymentSheet with the returned client_secret.
//   3. presentPaymentSheet — the native Apple/Google-Pay-capable sheet.
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
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export function usePayForMove() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isPaying, setIsPaying] = useState(false);

  async function pay(bookingId: string, tipCents = 0): Promise<PayResult> {
    setIsPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-create-payment-intent',
        { body: { booking_id: bookingId, tip_cents: Math.max(0, Math.round(tipCents)) } },
      );
      if (error) throw new Error(error.message ?? 'Could not start the payment.');
      if ((data as any)?.error) throw new Error((data as any).error);

      const clientSecret = (data as any).client_secret as string;
      const amountCents = (data as any).amount_cents as number;
      if (!clientSecret) throw new Error('Payment could not be started.');

      const init = await initPaymentSheet({
        merchantDisplayName: 'Movvy',
        paymentIntentClientSecret: clientSecret,
        // Return URL lets redirect-based methods (some wallets) come back to
        // the app. Matches the `movvy` scheme registered in app.json.
        returnURL: 'movvy://stripe-redirect',
        applePay: { merchantCountryCode: 'CA' },
        googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: true },
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
