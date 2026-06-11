// Admin operation hooks. RLS + edge-function auth-check enforce admin role.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

function ensureAdmin(role?: string) {
  if (!role || !['movvy_admin', 'movvy_support'].includes(role)) {
    throw new Error('Admins only');
  }
}

// ─── Verify partner (team or company) ───────────────────────────────────────

export function useVerifyPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      subject_type: 'team' | 'company';
      subject_id: string;
      decision: 'approve' | 'reject' | 'request_more';
      notes?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('admin-verify-partner', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pending-verifications'] });
      qc.invalidateQueries({ queryKey: ['my-teams'] });
      qc.invalidateQueries({ queryKey: ['my-companies'] });
    },
  });
}

// ─── Suspend / reinstate user ───────────────────────────────────────────────

export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { profile_id: string; action: 'suspend' | 'reinstate'; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke('admin-suspend-user', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ─── Reassign booking ───────────────────────────────────────────────────────

export function useReassignBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      booking_id: string;
      driver_profile_id?: string;
      team_id?: string;
      company_id?: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('admin-reassign-booking', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    },
  });
}

// ─── Resolve dispute ────────────────────────────────────────────────────────

export function useResolveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      dispute_id: string;
      resolution: 'resolved_customer' | 'resolved_partner' | 'closed';
      refund_cents?: number;
      notes: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('admin-resolve-dispute', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'disputes'] }),
  });
}

// ─── Promo codes ────────────────────────────────────────────────────────────

export function useCreatePromo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      code: string;
      kind: 'percent_off' | 'amount_off_cents' | 'free_service_fee';
      value: number;
      min_subtotal_cents?: number;
      max_redemptions?: number;
      per_user_limit?: number;
      city_slug?: string;
      expires_at?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('admin-create-promo', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promos'] }),
  });
}

export function useValidatePromo() {
  return useMutation({
    mutationFn: async (args: { code: string; subtotal_cents: number; city_slug?: string }) => {
      const { data, error } = await supabase.functions.invoke('promo-validate', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        ok: boolean;
        reason?: string;
        promo_id?: string;
        code?: string;
        discount_cents?: number;
      };
    },
  });
}

// ─── Admin queries (read-only data fetches) ─────────────────────────────────

export function useAdminPendingVerifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'pending-verifications'],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: teams }, { data: companies }] = await Promise.all([
        supabase
          .from('partner_teams')
          .select('id, display_name, primary_city_id, onboarding_status, created_at')
          .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress']),
        supabase
          .from('companies')
          .select('id, legal_name, display_name, primary_city_id, onboarding_status, created_at')
          .in('onboarding_status', ['in_review', 'docs_uploaded', 'in_progress']),
      ]);
      return { teams: teams ?? [], companies: companies ?? [] };
    },
  });
}

export function useAdminBookings(opts: { limit?: number } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'bookings', opts.limit],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, short_code, status, customer_id, move_type, scheduled_for_date, price_total_cents, created_at, pickup_city, dropoff_city')
        .order('created_at', { ascending: false })
        .limit(opts.limit ?? 50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminDisputes(open = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'disputes', open ? 'open' : 'all'],
    enabled: !!user,
    queryFn: async () => {
      const q = supabase
        .from('disputes')
        .select('id, booking_id, opened_by, kind, severity, summary, status, refund_cents, created_at')
        .order('created_at', { ascending: false });
      if (open) q.in('status', ['open', 'in_review']);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminSpendToday() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'spend-today'],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_spend_log')
        .select('service, cost_usd, cache_hit')
        .gte('created_at', new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
      if (error) throw error;
      // Aggregate
      const byService: Record<string, { calls: number; usd: number; cache_hits: number }> = {};
      for (const row of data ?? []) {
        const s = (byService[row.service] ??= { calls: 0, usd: 0, cache_hits: 0 });
        s.calls += 1;
        s.usd += Number(row.cost_usd ?? 0);
        if (row.cache_hit) s.cache_hits += 1;
      }
      return byService;
    },
  });
}
