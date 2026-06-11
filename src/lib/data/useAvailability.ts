// =============================================================================
// Driver availability blocks
//
// useMyBlockedDates  — list of YYYY-MM-DD dates the signed-in driver has
//                       marked unavailable.
// useToggleBlockedDate — flip a date on/off in one mutation; updates the
//                        cache optimistically so the calendar feels instant.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export function useMyBlockedDates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-blocked-dates', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('driver_availability_blocks')
        .select('blocked_date')
        .eq('driver_profile_id', user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.blocked_date as string));
    },
  });
}

export function useToggleBlockedDate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { date: string; currentlyBlocked: boolean }) => {
      if (args.currentlyBlocked) {
        const { error } = await supabase
          .from('driver_availability_blocks')
          .delete()
          .eq('driver_profile_id', user!.id)
          .eq('blocked_date', args.date);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('driver_availability_blocks')
          .insert({ driver_profile_id: user!.id, blocked_date: args.date });
        if (error) throw error;
      }
      return args;
    },
    // Optimistic update — flip the cached set immediately, rollback on error.
    onMutate: async ({ date, currentlyBlocked }) => {
      await qc.cancelQueries({ queryKey: ['my-blocked-dates', user?.id] });
      const prev = qc.getQueryData<Set<string>>(['my-blocked-dates', user?.id]);
      const next = new Set(prev ?? []);
      if (currentlyBlocked) next.delete(date);
      else next.add(date);
      qc.setQueryData(['my-blocked-dates', user?.id], next);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['my-blocked-dates', user?.id], ctx.prev);
    },
  });
}
