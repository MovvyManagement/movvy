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
  /** False for a crew member: payouts belong to the org and settle to the
   *  admin's banking details, so a crew member is not shown the balance. */
  can_view: boolean;
  hold_days: number;
  /** Payable on the next request day: completed, collected, and finished
   *  BEFORE the previous Monday (0109). Unclaimed amounts roll forward. */
  available_cents: number;
  /** Always 0 since 0103. Kept so an older build can't double-count it. */
  clearing_cents: number;
  /** Earned and collected, but the move finished too recently to be in this
   *  week's window — informational, NOT included in available_cents. */
  in_hold_cents: number;
  /** True only on a Monday (Alberta time) — requests are weekly. */
  is_request_day: boolean;
  /** The Monday a request can next be made, as YYYY-MM-DD. */
  next_request_day: string | null;
  /** A request has already been raised since this week's Monday. */
  requested_this_week: boolean;
  /** When the oldest held move passes the hold window. Informational only. */
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
  can_view: false,
  hold_days: 7,
  available_cents: 0,
  clearing_cents: 0,
  in_hold_cents: 0,
  is_request_day: false,
  next_request_day: null,
  requested_this_week: false,
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
