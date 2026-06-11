import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

export type DisputeKind = 'damage' | 'late' | 'no_show' | 'poor_service' | 'overcharge' | 'other';

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
      qc.invalidateQueries({ queryKey: ['my-disputes'] });
    },
  });
}

export function useMyDisputes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-disputes', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disputes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
