// Driver/company jobs feed.
// Open 'searching' bookings within the partner's service radius (60 km of
// their base city) are fair game — see open_jobs_for_me / migration 0038.
// In a later phase we'll also filter on scheduling fit + crew size.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';
import type { DbBooking } from '@/lib/supabase/types';

export function useAvailableJobs(citySlug = 'calgary') {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Realtime — new searching bookings (or status flips that take a job out
  // of the open pool) should land on the feed within ~100 ms. The 15s
  // refetchInterval below stays as a safety net for the rare case the
  // websocket drops mid-shift.
  useEffect(() => {
    if (!user?.id || !supabaseConfigured) return;
    // Unique per-mount channel name — see comment in useBookings.ts.
    const channelName = `jobs:available:${citySlug}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          // Cheap relevance filter — only refetch when an insert or
          // status-transition involves the searching state.
          const row = (payload.new ?? payload.old) as { status?: string } | null;
          if (!row) return;
          if (row.status === 'searching' || payload.eventType === 'INSERT') {
            qc.invalidateQueries({ queryKey: ['jobs', 'available', citySlug] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citySlug, user?.id]);

  return useQuery({
    queryKey: ['jobs', 'available', citySlug],
    enabled: !!user,
    refetchInterval: 15_000,  // safety-net poll; realtime above is the primary signal
    queryFn: async (): Promise<DbBooking[]> => {
      // Matching is distance-based (migration 0038): open_jobs_for_me returns
      // the unassigned 'searching' pool within the partner's service radius of
      // their own base city, derived server-side from auth.uid(). citySlug is
      // retained only for the query key + the realtime channel name above.
      const { data, error } = await supabase.rpc('open_jobs_for_me');
      if (error) throw error;
      return (data ?? []) as DbBooking[];
    },
  });
}

export function useMyAssignedJobs() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Realtime — every state transition on a booking I'm the assigned driver
  // for (left HQ → arrived → loading → ...) refreshes the list so the
  // driver's Active screen flips instantly. Otherwise their UI lags one
  // poll behind their own taps via other devices / dispatcher overrides.
  useEffect(() => {
    if (!user?.id || !supabaseConfigured) return;
    const channelName = `jobs:assigned:${user.id}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `assigned_driver_profile_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['jobs', 'assigned', user.id] });
          qc.invalidateQueries({ queryKey: ['my-current-job'] });
          qc.invalidateQueries({ queryKey: ['my-team-current-job'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return useQuery({
    queryKey: ['jobs', 'assigned', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DbBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        // The assigned performer OR whoever was picked as the live-location
        // source ("We've left HQ" → whose location the customer follows) sees
        // the active job, so the source's phone can broadcast.
        .or(`assigned_driver_profile_id.eq.${user!.id},tracking_profile_id.eq.${user!.id}`)
        .in('status', ['assigned', 'confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'])
        .order('scheduled_for_window_starts_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbBooking[];
    },
  });
}

export function useMyCurrentJob() {
  const { data, ...rest } = useMyAssignedJobs();
  return { ...rest, data: data?.[0] ?? null };
}

/**
 * Job the signed-in user's TEAM (partner_teams) is currently on, regardless
 * of which team member is the assigned driver. Used for the mover (2nd team
 * member) passenger view — they need to see what their driver is doing
 * even though they aren't assigned_driver_profile_id themselves.
 *
 * Returns null when:
 *   • the user isn't on a team (e.g. they're a customer / company driver)
 *   • the team has no in-flight booking
 */
export function useMyTeamCurrentJob() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-team-current-job', user?.id],
    enabled: !!user,
    refetchInterval: 12_000,
    queryFn: async (): Promise<DbBooking | null> => {
      // 1) find the org this profile belongs to. company_members, not
      //    partner_team_members — the latter was retired with the merged org
      //    model (0068) and is empty, so this returned null for everyone and
      //    the passenger view never worked: the second crew member on a move
      //    saw nothing at all while their driver was mid-job.
      const { data: membership } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('profile_id', user!.id)
        .eq('status', 'active')
        .is('removed_at', null)
        .limit(1)
        .maybeSingle();
      if (!membership?.company_id) return null;

      // 2) the org's in-flight booking, by assigned_company_id — jobs are
      //    accepted by companies now, so assigned_team_id is never set.
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('assigned_company_id', membership.company_id)
        .in('status', ['assigned', 'confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'])
        .order('scheduled_for_window_starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as DbBooking | null;
    },
  });
}
