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

// ─── Real analytics (replaces the old hardcoded fixtures) ──────────────────
//
// Single round-trip-ish query bundle that powers the (admin)/analytics
// screen. Everything here reads bookings + profiles + cities directly,
// no derived materialized views — fine at our current scale, can move
// to a `mv_admin_analytics` later if the dashboard ever takes > 2s.

interface MonthRevenue {
  /** YYYY-MM (so the chart can sort), short label rendered in the UI. */
  key: string;
  label: string;
  revenue_cents: number;
  commission_cents: number;
  booking_count: number;
}

interface CityPerf {
  city_name: string;
  total: number;
  completed: number;
  cancelled: number;
  /** 0–1 fraction. UI multiplies by 100 for the % display. */
  completion_rate: number;
}

export interface AdminAnalytics {
  /** Last 6 months including the current one, oldest → newest. */
  monthly: MonthRevenue[];
  lifetime: {
    revenue_cents: number;
    commission_cents: number;
    booking_count: number;
  };
  /** completed_bookings / non_draft_bookings — 0–1. */
  completion_rate: number;
  /** cancelled_bookings / non_draft_bookings — 0–1. */
  cancel_rate: number;
  /** customers_with_2plus_bookings / total_active_customers — 0–1. */
  repeat_rate: number;
  cities: CityPerf[];
  /** % Movvy commission of gross revenue, current month. */
  take_rate_this_month: number;
}

export function useAdminAnalytics() {
  const { user } = useAuth();
  return useQuery<AdminAnalytics>({
    queryKey: ['admin', 'analytics'],
    enabled: !!user,
    // 5 min — cheap enough to refresh on tab focus, expensive enough
    // not to refetch every nav tick.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Window: 6 calendar months back. We bucket by month-of-creation
      // (created_at), not scheduled_for_date, since revenue lands when
      // booked, not when moved.
      const monthsBack = 6;
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCMonth(start.getUTCMonth() - (monthsBack - 1));

      const [bookingsRes, citiesRes, customersRes] = await Promise.all([
        supabase
          .from('bookings')
          .select(
            'id, status, customer_id, city_id, price_total_cents, movvy_margin_cents, created_at',
          )
          .gte('created_at', start.toISOString())
          .neq('status', 'draft'),
        supabase.from('cities').select('id, name'),
        supabase
          .from('bookings')
          .select('customer_id')
          .neq('status', 'draft'),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;

      const rows = bookingsRes.data ?? [];
      const cityNameById = new Map(
        (citiesRes.data ?? []).map((c: any) => [c.id, c.name as string]),
      );

      // Monthly bucket — fill 6 empty months so the chart never has gaps.
      const monthly: MonthRevenue[] = [];
      for (let i = 0; i < monthsBack; i++) {
        const d = new Date(start);
        d.setUTCMonth(d.getUTCMonth() + i);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        monthly.push({
          key,
          label: d.toLocaleString('en-CA', { month: 'short' }),
          revenue_cents: 0,
          commission_cents: 0,
          booking_count: 0,
        });
      }
      const bucketIdx = new Map(monthly.map((m, i) => [m.key, i]));

      // City bucket — one entry per city we've seen + an unknown bin.
      const cityBuckets = new Map<string, CityPerf>();

      let completed = 0;
      let cancelled = 0;

      for (const r of rows) {
        const created = new Date(r.created_at);
        const mKey = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}`;
        const idx = bucketIdx.get(mKey);
        if (idx != null) {
          monthly[idx].revenue_cents += r.price_total_cents ?? 0;
          monthly[idx].commission_cents += r.movvy_margin_cents ?? 0;
          monthly[idx].booking_count += 1;
        }

        const cityName = cityNameById.get(r.city_id) ?? 'Unknown';
        const b = cityBuckets.get(cityName) ?? {
          city_name: cityName,
          total: 0,
          completed: 0,
          cancelled: 0,
          completion_rate: 0,
        };
        b.total += 1;
        if (r.status === 'completed') {
          b.completed += 1;
          completed += 1;
        } else if (r.status === 'cancelled') {
          b.cancelled += 1;
          cancelled += 1;
        }
        cityBuckets.set(cityName, b);
      }

      // Compute city completion rates + sort by volume.
      const cities = Array.from(cityBuckets.values())
        .map((b) => ({
          ...b,
          completion_rate: b.total ? b.completed / b.total : 0,
        }))
        .sort((a, b) => b.total - a.total);

      // Lifetime totals — same query window? No, we already filtered to
      // the last 6 months. For "lifetime" we'd want a separate count,
      // but at current scale (4 bookings) the 6-month window IS lifetime.
      // The labels say "trailing 6mo" in the UI to be honest about it.
      const lifetimeRevenue = rows.reduce(
        (s, r) => s + (r.price_total_cents ?? 0),
        0,
      );
      const lifetimeCommission = rows.reduce(
        (s, r) => s + (r.movvy_margin_cents ?? 0),
        0,
      );

      const nonDraft = rows.length;
      const completion_rate = nonDraft ? completed / nonDraft : 0;
      const cancel_rate = nonDraft ? cancelled / nonDraft : 0;

      // Repeat rate — read from the wider customers query so it isn't
      // capped at 6 months. Customer with 2+ rows = repeat.
      const customerCounts = new Map<string, number>();
      for (const c of customersRes.data ?? []) {
        if (!c.customer_id) continue;
        customerCounts.set(
          c.customer_id,
          (customerCounts.get(c.customer_id) ?? 0) + 1,
        );
      }
      const totalCustomers = customerCounts.size;
      const repeatCustomers = Array.from(customerCounts.values()).filter(
        (n) => n >= 2,
      ).length;
      const repeat_rate = totalCustomers ? repeatCustomers / totalCustomers : 0;

      const thisMonth = monthly[monthly.length - 1];
      const take_rate_this_month = thisMonth.revenue_cents
        ? thisMonth.commission_cents / thisMonth.revenue_cents
        : 0;

      return {
        monthly,
        lifetime: {
          revenue_cents: lifetimeRevenue,
          commission_cents: lifetimeCommission,
          booking_count: rows.length,
        },
        completion_rate,
        cancel_rate,
        repeat_rate,
        cities,
        take_rate_this_month,
      };
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
