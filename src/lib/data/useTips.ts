import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface TipArgs {
  booking_id: string;
  /** Tip amount in CENTS. UI usually passes dollars × 100. */
  amount_cents: number;
}

export function useSubmitTip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TipArgs) => {
      const { data, error } = await supabase.functions.invoke('tips-submit', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; tipCents: number; movvyCutCents: number; driverCents: number };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
    },
  });
}
