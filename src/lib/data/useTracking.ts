// Live driver location tracking via Supabase Realtime.
// Customer's tracking screen subscribes to booking_tracking inserts for their booking.

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export interface TrackingPing {
  id: number;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kph: number | null;
  recorded_at: string;
}

/** Driver-side: send a GPS ping. Call on a 5-second interval while moving. */
export function useSendTrackingPing() {
  return useMutation({
    mutationFn: async (args: { booking_id: string; lat: number; lng: number; heading?: number; speed_kph?: number }) => {
      const { data, error } = await supabase.functions.invoke('tracking-ping', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
}

/** Customer-side: live driver location for a booking. */
export function useLiveTracking(bookingId: string | undefined) {
  const [ping, setPing] = useState<TrackingPing | null>(null);

  useEffect(() => {
    if (!bookingId) return;

    let cancelled = false;

    // Initial fetch of the most recent ping (so the map renders immediately on open)
    (async () => {
      const { data } = await supabase
        .from('booking_tracking')
        .select('id, lat, lng, heading, speed_kph, recorded_at')
        .eq('booking_id', bookingId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setPing(data as TrackingPing);
    })();

    // Subscribe to new pings as they arrive. Unique per-mount channel name
    // — supabase-js v2 caches channels by topic, so reusing the same name
    // across StrictMode mount/unmount cycles throws "cannot add callbacks
    // after subscribe()". The Date.now() suffix forces a fresh channel.
    const channel = supabase
      .channel(`tracking-${bookingId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'booking_tracking', filter: `booking_id=eq.${bookingId}` },
        (payload) => {
          if (!cancelled) setPing(payload.new as TrackingPing);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [bookingId]);

  return ping;
}

/** The crew identity a customer is allowed to see for one of THEIR bookings. */
export interface BookingCrew {
  kind: 'company' | 'team' | null;
  display_name: string | null;
  rating_avg: number | null;
  rating_count: number | null;
  verified: boolean;
  driver_name: string | null;
  driver_avatar_url: string | null;
}

/** Customer-side: who accepted this booking. Resolves the company/team's
 *  public display name (+ rating, verified, assigned driver) via the
 *  booking_crew RPC — SECURITY DEFINER, gated on customer_id, so partner
 *  identities stay private to everyone but the booking's own customer.
 *  Returns null while the move is still unassigned (the UI falls back to the
 *  anonymous "Your crew"). */
export function useBookingCrew(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['booking-crew', bookingId],
    enabled: !!bookingId && supabaseConfigured,
    queryFn: async (): Promise<BookingCrew | null> => {
      const { data, error } = await supabase.rpc('booking_crew', {
        p_booking_id: bookingId!,
      });
      if (error) throw error;
      const row = (data as BookingCrew[] | null)?.[0];
      // A row with no display_name means "matched your booking, not yet
      // assigned" — collapse that to null so the caller's fallback kicks in.
      return row && row.display_name ? row : null;
    },
  });
}
