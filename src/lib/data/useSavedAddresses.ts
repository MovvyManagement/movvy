import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';
import type { DbSavedAddress } from '@/lib/supabase/types';

export function useSavedAddresses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['saved-addresses', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DbSavedAddress[]> => {
      const { data, error } = await supabase
        .from('saved_addresses')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DbSavedAddress[];
    },
  });
}

export function useSaveAddress() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      label?: string;
      line1: string;
      line2?: string;
      city_id: string;
      city_name: string;
      region: string;
      country_code: string;
      postal?: string;
      lat: number;
      lng: number;
      is_default?: boolean;
    }) => {
      if (!user) throw new Error('Not signed in');
      // If setting as default, unset others first
      if (args.is_default) {
        await supabase.from('saved_addresses').update({ is_default: false }).eq('profile_id', user.id);
      }
      const { data, error } = await supabase
        .from('saved_addresses')
        .insert({ ...args, profile_id: user.id })
        .select('*')
        .single();
      if (error) throw error;
      return data as DbSavedAddress;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-addresses'] }),
  });
}

export function useDeleteSavedAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('saved_addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-addresses'] }),
  });
}
