import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DbCity } from '@/lib/supabase/types';

/** Active cities — what the customer can book in. RLS gates inactive ones. */
export function useCities() {
  return useQuery({
    queryKey: ['cities', 'active'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DbCity[]> => {
      const { data, error } = await supabase
        .from('cities')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as DbCity[];
    },
  });
}

export function useCityBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['city', slug],
    enabled: !!slug,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DbCity | null> => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('cities')
        .select('*')
        .eq('slug', slug)
        .single();
      if (error) throw error;
      return data as DbCity;
    },
  });
}
