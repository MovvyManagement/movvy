// =============================================================================
// Public review feed
//
// Reads aggregated customer-to-partner ratings via the
// public_reviews_for_team / public_reviews_for_company RPCs (migration 0021).
// The RPC strips reviewer PII — only "First L." display name + text.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export interface PublicReview {
  rating_id: string;
  overall: number;
  comment: string | null;
  tags: string[] | null;
  created_at: string;
  reviewer_display: string;
}

export function useTeamReviews(teamId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ['public-reviews', 'team', teamId, limit],
    enabled: !!teamId && supabaseConfigured,
    queryFn: async (): Promise<PublicReview[]> => {
      const { data, error } = await supabase.rpc('public_reviews_for_team', {
        p_team_id: teamId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as PublicReview[];
    },
  });
}

export function useCompanyReviews(companyId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ['public-reviews', 'company', companyId, limit],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<PublicReview[]> => {
      const { data, error } = await supabase.rpc('public_reviews_for_company', {
        p_company_id: companyId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as PublicReview[];
    },
  });
}
