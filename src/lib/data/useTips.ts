import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '@/lib/supabase';

interface TipArgs {
  booking_id: string;
  /** Tip amount in CENTS. UI usually passes dollars × 100. */
  amount_cents: number;
}

/**
 * Charge a post-move tip, then record it.
 *
 * The old hook called `tips-submit`, which only ever RECORDS a tip Stripe has
 * already captured — it takes no payment and refuses anything uncollected,
 * because the payout trigger would otherwise hand a crew money Movvy never
 * received. Nothing else collected a post-move tip, so every tap on the Move-
 * complete screen came back "Edge Function returned a non-2xx status code".
 *
 * `tips-charge` collects first. Usually that's one tap against the card saved
 * at checkout. When there's no saved card — anything booked before card-saving
 * shipped — or the issuer wants 3-D Secure, it returns `needs_action` with a
 * client secret and we finish in the Payment Sheet.
 *
 * `tips-submit` is left in place: it's still the right endpoint for recording a
 * tip that was collected at checkout inside the move's own PaymentIntent.
 */
export function useSubmitTip() {
  const qc = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  return useMutation({
    mutationFn: async (args: TipArgs) => {
      const { data, error } = await supabase.functions.invoke('tips-charge', { body: args });

      if (error) {
        // supabase-js flattens every non-2xx to "Edge Function returned a
        // non-2xx status code" — the sentence the customer was actually shown.
        // The real message is on the raw Response.
        let detail: string | undefined;
        try {
          const ctx = (error as any).context;
          if (ctx?.json) detail = (await ctx.json())?.error;
          else if (ctx?.text) detail = await ctx.text();
        } catch {
          /* fall through to the generic message */
        }
        throw new Error(detail || "Couldn't charge the tip. Try again.");
      }
      if ((data as any)?.error) throw new Error((data as any).error);

      // Card on file did it — no sheet, no second tap.
      if ((data as any)?.ok) {
        return { charged_cents: (data as any).charged_cents as number, presented: false };
      }

      // No saved card, or the bank wants the customer to approve.
      if ((data as any)?.needs_action && (data as any)?.client_secret) {
        const init = await initPaymentSheet({
          merchantDisplayName: 'Movvy',
          paymentIntentClientSecret: (data as any).client_secret,
          returnURL: 'movvy://stripe-redirect',
        });
        if (init.error) throw new Error(init.error.message);

        const res = await presentPaymentSheet();
        if (res.error) {
          if (res.error.code === 'Canceled') {
            // Not a failure — the customer backed out. Signalled rather than
            // thrown so the screen can close quietly instead of showing an
            // error for something they chose.
            return { charged_cents: 0, presented: true, canceled: true };
          }
          throw new Error(res.error.message);
        }

        // The webhook records the tip once Stripe confirms the charge, so the
        // booking may take a moment to reflect it. Nothing to write here.
        return { charged_cents: (data as any).amount_cents as number, presented: true };
      }

      throw new Error("Couldn't charge the tip. Try again.");
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
