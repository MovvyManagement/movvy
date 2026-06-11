// =============================================================================
// useEmailReceipt — fires the receipt-email edge fn for a completed booking
//
// The function emails the customer a plain-text + HTML receipt via Resend.
// No PDF attachment yet (deferred until we have a real renderer pipeline);
// the email body itself is the receipt.
// =============================================================================

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useEmailReceipt() {
  return useMutation({
    mutationFn: async (args: { booking_id: string; email?: string }) => {
      const { data, error } = await supabase.functions.invoke('receipt-email', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; sent_to: string };
    },
  });
}
