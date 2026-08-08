// =============================================================================
// Payout requests — the crew's side of getting paid.
//
// Movvy sends money by hand (e-Transfer or bank deposit), so this is a request
// queue, not a transfer API. What a crew can withdraw is decided entirely
// server-side by my_payout_summary() (migration 0092): completed, collected,
// held seven days, less penalties and anything already claimed. The client
// never proposes an amount — it asks for whatever the server says is available.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export type PayoutMethod = 'etransfer' | 'bank';

export interface OpenPayoutRequest {
  id: string;
  amount_cents: number;
  method: PayoutMethod;
  status: 'pending' | 'approved';
  created_at: string;
}

export interface PayoutSummary {
  company_id: string | null;
  is_org_admin: boolean;
  hold_days: number;
  /** Withdrawable right now. */
  available_cents: number;
  /** Earned and collected, still inside the hold window. */
  clearing_cents: number;
  /** When the oldest held move clears. */
  next_available_at: string | null;
  /** Tips inside available_cents — called out so a crew sees them. */
  tips_cents: number;
  penalties_cents: number;
  lifetime_paid_cents: number;
  open_request: OpenPayoutRequest | null;
}

const EMPTY: PayoutSummary = {
  company_id: null,
  is_org_admin: false,
  hold_days: 7,
  available_cents: 0,
  clearing_cents: 0,
  next_available_at: null,
  tips_cents: 0,
  penalties_cents: 0,
  lifetime_paid_cents: 0,
  open_request: null,
};

export function usePayoutSummary() {
  return useQuery({
    queryKey: ['payout-summary'],
    enabled: supabaseConfigured,
    // Someone watching this screen after a move wants to see it land.
    refetchInterval: 60_000,
    queryFn: async (): Promise<PayoutSummary> => {
      const { data, error } = await supabase.rpc('my_payout_summary');
      if (error) throw error;
      return { ...EMPTY, ...((data ?? {}) as Partial<PayoutSummary>) };
    },
  });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (method: PayoutMethod) => {
      const { data, error } = await supabase.rpc('request_payout', { p_method: method });
      // The RPC raises with a human sentence ("Add your e-Transfer email…"),
      // so pass it straight through rather than replacing it.
      if (error) throw new Error(error.message);
      return data as { ok: boolean; id: string; amount_cents: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payout-summary'] }),
  });
}

export function useCancelPayoutRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('cancel_payout_request', { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payout-summary'] }),
  });
}
