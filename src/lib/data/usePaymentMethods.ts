// =============================================================================
// usePaymentMethods — saved-card management for the customer
//
// Backs the /(customer)/payment-methods screen and the Profile → Payment
// methods row. We never store the full PAN or CVV — only the safe display
// metadata (brand, last4, exp, cardholder, billing postal). Phase 3 will
// swap the storage for Stripe tokenized payment methods; until then this is
// a real, persisted "cards I told Movvy about" registry.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'other';

export interface PaymentMethodRow {
  id: string;
  profile_id: string;
  brand: CardBrand;
  last4: string;
  exp_month: number;
  exp_year: number;
  cardholder_name: string;
  billing_postal: string | null;
  stripe_payment_method_id: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const QK = ['payment-methods'] as const;

export function usePaymentMethods() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<PaymentMethodRow[]> => {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('profile_id', user!.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
  });
}

export interface SavePaymentMethodArgs {
  brand: CardBrand;
  last4: string;
  exp_month: number;
  exp_year: number;
  cardholder_name: string;
  billing_postal?: string | null;
  is_default?: boolean;
}

export function useSavePaymentMethod() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: SavePaymentMethodArgs) => {
      if (!user) throw new Error('Sign in first');

      // If this card is being marked default, demote any existing default
      // first — the partial unique index (one default per profile) would
      // otherwise reject the insert.
      if (args.is_default) {
        await supabase
          .from('payment_methods')
          .update({ is_default: false })
          .eq('profile_id', user.id)
          .eq('is_default', true);
      }

      const { data, error } = await supabase
        .from('payment_methods')
        .insert({
          profile_id: user.id,
          brand: args.brand,
          last4: args.last4,
          exp_month: args.exp_month,
          exp_year: args.exp_year,
          cardholder_name: args.cardholder_name.trim(),
          billing_postal: args.billing_postal?.trim() || null,
          is_default: args.is_default ?? false,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data as PaymentMethodRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useSetDefaultPaymentMethod() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Sign in first');
      // Demote the current default first to avoid the partial-unique-index
      // collision, then promote the chosen card.
      await supabase
        .from('payment_methods')
        .update({ is_default: false })
        .eq('profile_id', user.id)
        .eq('is_default', true);
      const { error } = await supabase
        .from('payment_methods')
        .update({ is_default: true })
        .eq('id', id)
        .eq('profile_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useDeletePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payment_methods').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

// ─── Card-number helpers ────────────────────────────────────────────────────

/** Detect brand from the leading digits of a PAN. */
export function detectCardBrand(pan: string): CardBrand {
  const digits = pan.replace(/\D/g, '');
  if (/^4\d{0,}$/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])\d{0,}$/.test(digits)) return 'mastercard';
  if (/^3[47]\d{0,}$/.test(digits)) return 'amex';
  if (/^(6011|65|64[4-9])\d{0,}$/.test(digits)) return 'discover';
  return 'other';
}

/** Format a PAN with single-space groups (4-4-4-4, or 4-6-5 for Amex). */
export function formatCardNumber(pan: string, brand?: CardBrand): string {
  const digits = pan.replace(/\D/g, '').slice(0, 19);
  const b = brand ?? detectCardBrand(digits);
  if (b === 'amex') {
    return digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*$/, (_, a, c, d) =>
      [a, c, d].filter(Boolean).join(' '),
    );
  }
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/** Luhn check — front-line validity (real fraud detection is server-side). */
export function isValidLuhn(pan: string): boolean {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function expectedPanLength(brand: CardBrand): number {
  return brand === 'amex' ? 15 : 16;
}
