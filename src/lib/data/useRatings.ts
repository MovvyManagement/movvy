import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface RatingArgs {
  booking_id: string;
  party: 'customer_to_partner' | 'partner_to_customer';
  overall: number;
  professionalism?: number;
  timeliness?: number;
  carefulness?: number;
  communication?: number;
  tags?: string[];
  comment?: string;
}

export function useSubmitRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: RatingArgs) => {
      const { data, error } = await supabase.functions.invoke('ratings-submit', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; rating_id: string };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
    },
  });
}
