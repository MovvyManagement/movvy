// =============================================================================
// useDispatcherPing — send a quick "can you take this?" capacity-check note
// to a driver before assigning them a booking.
//
// Implementation: writes an in_app notification (channel='in_app') to the
// target driver with category 'dispatch.capacity_check' and the booking
// summary in data. Reuses the existing notifications inbox UI — no new
// surface required to surface it on the driver's side.
//
// RLS allows the company owner/dispatcher to insert into notifications via
// the user-scoped client because the policy is permissive on inserts —
// the channel/category fields are validated client-side. (Service-role
// audit trail not required for an internal capacity ping.)
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface Args {
  driver_profile_id: string;
  booking_id: string;
  booking_short_code: string;
  message: string;
}

export function useDispatcherPing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: Args) => {
      const { error } = await supabase.from('notifications').insert({
        profile_id: args.driver_profile_id,
        channel: 'in_app',
        category: 'dispatch.capacity_check',
        title: `Capacity check for #${args.booking_short_code}`,
        body: args.message,
        data: { booking_id: args.booking_id, short_code: args.booking_short_code },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
