// =============================================================================
// useEarningsStatement — fetch driver_payouts for a partner and build a
// printable statement (PDF + CSV).
//
// Three flavours:
//   • { driverProfileId } → solo driver / partner-team member
//   • { teamId }          → 2-person team aggregate
//   • { companyId }       → whole-company aggregate (owner / dispatcher view)
//
// Periods are calendar years for now ("2026"); we expose a `year` arg so the
// UI can let the partner pick last year for tax season. The hook only fetches
// on demand (enabled when `year` is set) so the earnings tab stays cheap.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import {
  buildEarningsStatement,
  type EarningsLineItem,
  type EarningsStatementData,
} from '@/lib/earnings';

interface Args {
  /** Calendar year ("2026"). */
  year: number;
  partnerName: string;
  driverProfileId?: string;
  teamId?: string;
  companyId?: string;
  enabled?: boolean;
}

export function useEarningsStatement({
  year,
  partnerName,
  driverProfileId,
  teamId,
  companyId,
  enabled = true,
}: Args) {
  return useQuery({
    queryKey: ['earnings-statement', year, driverProfileId, teamId, companyId],
    enabled: enabled && supabaseConfigured && !!(driverProfileId || teamId || companyId),
    queryFn: async (): Promise<EarningsStatementData> => {
      const start = `${year}-01-01T00:00:00Z`;
      const end = `${year + 1}-01-01T00:00:00Z`;

      // driver_payouts carries the gross / margin / net split for each
      // completed booking; the booking row is joined for route metadata.
      let query = supabase
        .from('driver_payouts')
        .select(
          'gross_cents, movvy_margin_cents, net_cents, created_at, ' +
            'booking:bookings!inner(short_code, completed_at, pickup_city, dropoff_city)',
        )
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true });

      if (driverProfileId) query = query.eq('driver_profile_id', driverProfileId);
      else if (teamId) query = query.eq('team_id', teamId);
      else if (companyId) query = query.eq('company_id', companyId);

      const { data, error } = await query;
      if (error) throw error;

      const jobs: EarningsLineItem[] = (data ?? []).map((row: any) => {
        const b = row.booking ?? {};
        const route =
          b.pickup_city && b.dropoff_city
            ? `${b.pickup_city} → ${b.dropoff_city}`
            : b.pickup_city ?? 'Movvy move';
        return {
          date: (b.completed_at ?? row.created_at ?? '').slice(0, 10),
          shortCode: b.short_code ?? '—',
          route,
          grossCents: row.gross_cents ?? 0,
          feeCents: row.movvy_margin_cents ?? 0,
          netCents: row.net_cents ?? 0,
        };
      });

      return buildEarningsStatement(partnerName, String(year), jobs);
    },
  });
}
