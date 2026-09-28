// =============================================================================
// usePaymentMethods — saved-card management, backed by Stripe
//
// Cards live on the customer's Stripe customer object, not in our database.
// They're collected and tokenized by Stripe's native Payment Sheet (a
// SetupIntent), so a raw card number never touches the app or our servers — the
// screen only ever sees brand / last4 / expiry that Stripe hands back. The same
// saved cards power one-tap checkout in usePayForMove.
//
// All Stripe calls go through the stripe-payment-methods edge function, which
// resolves the caller's Stripe customer server-side (a customer can only ever
// see or change their own cards).
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase, useAuth } from '@/lib/supabase';

export interface PaymentMethodRow {
  /** Stripe PaymentMethod id (pm_...). */
  id: string;
  /** Stripe card brand: 'visa' | 'mastercard' | 'amex' | 'discover' | … */
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

const QK = ['payment-methods'] as const;

async function invokePM<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('stripe-payment-methods', { body });
  if (error) throw new Error(error.message ?? 'Could not reach payments.');
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function usePaymentMethods() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<PaymentMethodRow[]> => {
      const data = await invokePM<{ cards: PaymentMethodRow[] }>({ action: 'list' });
      return data.cards ?? [];
    },
  });
}

/**
 * Present Stripe's native Payment Sheet in "save a card" mode (SetupIntent).
 * Resolves to 'added' when a card was saved, 'canceled' if the customer
 * dismissed the sheet. Throws only on a real failure.
 */
export function useAddCard() {
  const qc = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return useMutation({
    mutationFn: async (): Promise<'added' | 'canceled'> => {
      const setup = await invokePM<{
        setup_intent_client_secret: string;
        ephemeral_key_secret: string | null;
        customer_id: string;
      }>({ action: 'setup' });
      if (!setup.setup_intent_client_secret) throw new Error('Could not start card setup.');

      const init = await initPaymentSheet({
        merchantDisplayName: 'Movvy',
        setupIntentClientSecret: setup.setup_intent_client_secret,
        ...(setup.customer_id && setup.ephemeral_key_secret
          ? { customerId: setup.customer_id, customerEphemeralKeySecret: setup.ephemeral_key_secret }
          : {}),
        returnURL: 'movvy://stripe-redirect',
      });
      if (init.error) throw new Error(init.error.message);

      const res = await presentPaymentSheet();
      if (res.error) {
        if (res.error.code === 'Canceled') return 'canceled';
        throw new Error(res.error.message);
      }
      return 'added';
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useSetDefaultPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await invokePM({ action: 'set_default', payment_method_id: id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useDeletePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await invokePM({ action: 'detach', payment_method_id: id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
