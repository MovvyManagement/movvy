// =============================================================================
// useEarnings — summary hooks for the Earnings tabs (driver + company).
//
// Both screens used to render mockEarnings (week/today/month/recent payouts
// hardcoded). These hooks pull the real numbers from driver_payouts so the
// numbers a driver / owner sees match the bank deposits they'll actually get.
//
// Daily bars + "X% vs last week / last month" deltas come straight from the
// same table — one query for the active window, one for the previous window,
// computed in JS to keep RLS simple.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured, useAuth } from '@/lib/supabase';

const MS_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d = new Date()): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - 6); // rolling 7-day window
  return x;
}

function startOfMonth(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return x;
}

export interface DriverEarningsSummary {
  todayCents: number;
  weekCents: number;
  monthCents: number;
  /** YESTERDAY's total — used for the "+X% vs yesterday" delta on Today tile. */
  yesterdayCents: number;
  /** Bars for the last 7 days, oldest → newest. */
  weekBars: number[];
  weekLabels: string[];
  monthTripCount: number;
  recent: {
    id: string;
    netCents: number;
    createdAt: string;
    shortCode: string | null;
  }[];
}

export function useDriverEarningsSummary() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver-earnings-summary', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<DriverEarningsSummary> => {
      const now = new Date();
      const monthStart = startOfMonth(now);

      // Pull the whole month + last week in one query so we can derive
      // today / yesterday / week / month locally.
      const cutoff = new Date(Math.min(monthStart.getTime(), startOfDay(now).getTime() - 7 * MS_DAY));
      const { data, error } = await supabase
        .from('driver_payouts')
        .select(
          'id, net_cents, created_at, booking:bookings(short_code)',
        )
        .eq('driver_profile_id', user!.id)
        .gte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;

      // PostgREST returns joined rows as a nested array when it can't infer
      // cardinality from the FK alone; we know the booking → payout is 1-to-1
      // so we normalise to a single object below. Cast through unknown to
      // bypass the strict shape mismatch.
      const rows = ((data ?? []) as unknown) as Array<{
        id: string;
        net_cents: number;
        created_at: string;
        booking: { short_code: string | null } | { short_code: string | null }[] | null;
      }>;

      const t0 = startOfDay(now).getTime();
      const yesterdayStart = t0 - MS_DAY;
      const weekStart = startOfWeek(now).getTime();

      let todayCents = 0;
      let yesterdayCents = 0;
      let weekCents = 0;
      let monthCents = 0;
      let monthTripCount = 0;

      // 7-day bars, oldest → newest. weekBars[6] is today.
      const weekBars = Array(7).fill(0);

      for (const r of rows) {
        const t = new Date(r.created_at).getTime();
        const cents = r.net_cents ?? 0;
        if (t >= t0) todayCents += cents;
        else if (t >= yesterdayStart) yesterdayCents += cents;
        if (t >= weekStart) weekCents += cents;
        if (t >= monthStart.getTime()) {
          monthCents += cents;
          monthTripCount += 1;
        }
        if (t >= weekStart) {
          const dayIdx = Math.min(6, Math.max(0, Math.floor((t - weekStart) / MS_DAY)));
          weekBars[dayIdx] += cents;
        }
      }

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const weekLabels: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + i * MS_DAY);
        weekLabels.push(dayNames[d.getDay()]);
      }

      return {
        todayCents,
        weekCents,
        monthCents,
        yesterdayCents,
        weekBars,
        weekLabels,
        monthTripCount,
        recent: rows.slice(0, 5).map((r) => {
          const b = Array.isArray(r.booking) ? r.booking[0] : r.booking;
          return {
            id: r.id,
            netCents: r.net_cents ?? 0,
            createdAt: r.created_at,
            shortCode: b?.short_code ?? null,
          };
        }),
      };
    },
  });
}

export interface CompanyEarningsSummary {
  monthCents: number;
  previousMonthCents: number;
  /** Whole-numbers — booking count for the period. */
  monthJobCount: number;
  avgPayoutCents: number;
  topDrivers: {
    profileId: string;
    fullName: string;
    netCents: number;
    tripCount: number;
  }[];
}

export function useCompanyEarningsSummary(companyId: string | null) {
  return useQuery({
    queryKey: ['company-earnings-summary', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<CompanyEarningsSummary> => {
      const now = new Date();
      const thisMonthStart = startOfMonth(now);
      const prevMonthStart = new Date(thisMonthStart);
      prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);

      // One read window: previous month start → now. We split in JS.
      const { data, error } = await supabase
        .from('driver_payouts')
        .select(
          'driver_profile_id, net_cents, created_at, driver:profiles(full_name)',
        )
        .eq('company_id', companyId!)
        .gte('created_at', prevMonthStart.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = ((data ?? []) as unknown) as Array<{
        driver_profile_id: string;
        net_cents: number;
        created_at: string;
        driver: { full_name: string | null } | { full_name: string | null }[] | null;
      }>;

      let monthCents = 0;
      let previousMonthCents = 0;
      let monthJobCount = 0;
      const byDriver = new Map<
        string,
        { fullName: string; netCents: number; tripCount: number }
      >();

      for (const r of rows) {
        const t = new Date(r.created_at).getTime();
        const cents = r.net_cents ?? 0;
        if (t >= thisMonthStart.getTime()) {
          monthCents += cents;
          monthJobCount += 1;
          const key = r.driver_profile_id;
          const driver = Array.isArray(r.driver) ? r.driver[0] : r.driver;
          const cur = byDriver.get(key) ?? {
            fullName: driver?.full_name ?? '—',
            netCents: 0,
            tripCount: 0,
          };
          cur.netCents += cents;
          cur.tripCount += 1;
          byDriver.set(key, cur);
        } else {
          previousMonthCents += cents;
        }
      }

      const topDrivers = Array.from(byDriver.entries())
        .map(([profileId, v]) => ({ profileId, ...v }))
        .sort((a, b) => b.netCents - a.netCents)
        .slice(0, 5);

      return {
        monthCents,
        previousMonthCents,
        monthJobCount,
        avgPayoutCents: monthJobCount > 0 ? Math.round(monthCents / monthJobCount) : 0,
        topDrivers,
      };
    },
  });
}

// ─── Late-release penalties ──────────────────────────────────────────────────
// $100 charged when an org releases a move less than 3 days out. Surfaced on the
// company Earnings screen as negative lines so the admin sees exactly what a
// late release cost them (and can tie it back to a booking).

export interface ReleasePenalty {
  id: string;
  booking_id: string;
  amount_cents: number;
  reason: string | null;
  created_at: string;
  short_code: string | null;
}

export function useReleasePenalties(companyId: string | null, daysBack = 60) {
  return useQuery({
    queryKey: ['release-penalties', companyId, daysBack],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<ReleasePenalty[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('release_penalties')
        .select('id, booking_id, amount_cents, reason, created_at, booking:bookings(short_code)')
        .eq('company_id', companyId!)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        booking_id: r.booking_id,
        amount_cents: r.amount_cents,
        reason: r.reason,
        created_at: r.created_at,
        short_code: Array.isArray(r.booking) ? r.booking[0]?.short_code ?? null : r.booking?.short_code ?? null,
      }));
    },
  });
}
