// =============================================================================
// Feature flags + API budgets — admin-side hooks
//
// The DB already stores these (migrations 0008 + 0027). Until now the only
// way to flip a flag or change a cap was via SQL — fine for the founder,
// scary for support. These hooks back the admin Feature Flags tab so any
// movvy_admin can kill a paid API or raise a budget without touching SQL.
//
// RLS:
//   • feature_flags : admin read, full-admin write   (migration 0008)
//   • api_budgets   : admin read, full-admin write   (migration 0008)
//   • api_spend_log : admin read                     (migration 0008)
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
  updated_at: string;
}

export function useFeatureFlags() {
  return useQuery({
    queryKey: ['admin', 'feature-flags'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<FeatureFlagRow[]> => {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('key, enabled, description, updated_at')
        .order('key');
      if (error) throw error;
      return (data ?? []) as FeatureFlagRow[];
    },
  });
}

export function useToggleFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('feature_flags')
        .update({ enabled: args.enabled, updated_at: new Date().toISOString() })
        .eq('key', args.key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }),
  });
}

export interface ApiBudgetRow {
  service: string;
  daily_cap_usd: number;
  monthly_cap_usd: number;
  alert_threshold_pct: number;
  hard_stop: boolean;
}

export function useApiBudgets() {
  return useQuery({
    queryKey: ['admin', 'api-budgets'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<ApiBudgetRow[]> => {
      const { data, error } = await supabase
        .from('api_budgets')
        .select('service, daily_cap_usd, monthly_cap_usd, alert_threshold_pct, hard_stop')
        .order('service');
      if (error) throw error;
      return (data ?? []) as ApiBudgetRow[];
    },
  });
}

export function useUpdateApiBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      service: string;
      daily_cap_usd?: number;
      monthly_cap_usd?: number;
      hard_stop?: boolean;
    }) => {
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.daily_cap_usd !== undefined) patch.daily_cap_usd = args.daily_cap_usd;
      if (args.monthly_cap_usd !== undefined) patch.monthly_cap_usd = args.monthly_cap_usd;
      if (args.hard_stop !== undefined) patch.hard_stop = args.hard_stop;
      const { error } = await supabase
        .from('api_budgets')
        .update(patch)
        .eq('service', args.service);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'api-budgets'] }),
  });
}
