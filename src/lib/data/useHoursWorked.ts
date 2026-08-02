// =============================================================================
// useHoursWorked — hours-per-day for an hourly crew member, last 14 days.
//
// Hourly crew are paid a wage by their crew admin, not per move, so the Pay tab
// shows no dollars. What they DO need is a record of the time they put in:
// hours worked each day, newest first, over the past two weeks — something they
// can check against their paycheque.
//
// Derived from bookings they performed: started_at → completed_at.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export interface WorkedDay {
  /** YYYY-MM-DD (local) */
  date: string;
  hours: number;
  moves: number;
}

export interface HoursWorked {
  days: WorkedDay[];
  totalHours: number;
  totalMoves: number;
}

export function useHoursWorked(daysBack = 14) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['hours-worked', user?.id, daysBack],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<HoursWorked> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      since.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('bookings')
        .select('id, started_at, completed_at, tracking_profile_id, assigned_driver_profile_id')
        .or(
          `assigned_driver_profile_id.eq.${user!.id},tracking_profile_id.eq.${user!.id}`,
        )
        .eq('status', 'completed')
        .gte('completed_at', since.toISOString())
        .order('completed_at', { ascending: false });
      if (error) throw error;

      const byDay = new Map<string, WorkedDay>();
      let totalHours = 0;
      let totalMoves = 0;

      for (const b of data ?? []) {
        const start = (b as any).started_at ? new Date((b as any).started_at) : null;
        const end = (b as any).completed_at ? new Date((b as any).completed_at) : null;
        if (!start || !end) continue;
        const hrs = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
        // Bucket by the LOCAL calendar day the move finished on.
        const d = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
          end.getDate(),
        ).padStart(2, '0')}`;
        const row = byDay.get(d) ?? { date: d, hours: 0, moves: 0 };
        row.hours += hrs;
        row.moves += 1;
        byDay.set(d, row);
        totalHours += hrs;
        totalMoves += 1;
      }

      const days = Array.from(byDay.values())
        .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }))
        .sort((a, b) => b.date.localeCompare(a.date));

      return { days, totalHours: Math.round(totalHours * 10) / 10, totalMoves };
    },
  });
}
