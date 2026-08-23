import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DisputeKind = 'damage' | 'late' | 'no_show' | 'poor_service' | 'overcharge' | 'other';

/**
 * Raise a dispute on a booking.
 *
 * Still live: the customer live tracker and the crew's active-job screen both
 * open one from their "report a problem" path. The dedicated dispute FORM was
 * removed along with the support hub — support raises the formal record from
 * the chat thread now — but this endpoint is how those two screens still file
 * one, and the admin console's Disputes queue reads what it writes.
 *
 * `useMyDisputes` lived here too and was deleted: it backed the customer's
 * "my disputes" list, which went with the support hub, and nothing has read it
 * since.
 */
export function useOpenDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      booking_id: string;
      kind: DisputeKind;
      severity?: 'low' | 'medium' | 'high';
      summary: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('disputes-open', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['disputes', vars.booking_id] });
    },
  });
}
