import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';
import type { DbBooking } from '@/lib/supabase/types';

const IN_FLIGHT = [
  'pending','searching','assigned','confirmed','on_the_way',
  'arrived','loading','in_transit','unloading',
] as const;

/** All bookings for the signed-in customer, newest first. Includes a
 *  Realtime subscription so a status flip on the server (driver accepted,
 *  on_the_way, completed, ...) lands on the UI within ~100 ms instead of
 *  waiting for the next pull-to-refresh. */
export function useBookings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user?.id || !supabaseConfigured) return;
    // Use a unique per-mount channel name. supabase-js v2 caches channels
    // by topic and reuses the same instance on `.channel(name)` — under
    // StrictMode's mount → unmount → re-mount cycle (and on any deps-driven
    // re-run), the cached channel is already in the subscribed state and
    // calling `.on()` on it throws "cannot add postgres_changes callbacks
    // ... after subscribe()". The Date.now() suffix guarantees a fresh
    // channel every effect run; the cleanup tears down THIS channel
    // specifically by reference.
    const channelName = `bookings:customer:${user.id}:${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `customer_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['bookings', user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // qc is omitted from deps on purpose — it's a stable reference from
    // useQueryClient and including it would cause unnecessary resubscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return useQuery({
    queryKey: ['bookings', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<DbBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DbBooking[];
    },
  });
}

/** Just the active (in-flight) booking, if any. */
export function useActiveBooking() {
  const { data, ...rest } = useBookings();
  return {
    ...rest,
    data: data?.find((b) => (IN_FLIGHT as readonly string[]).includes(b.status)) ?? null,
  };
}

/** Just the customer's completed move history. */
export function useBookingHistory() {
  const { data, ...rest } = useBookings();
  return {
    ...rest,
    data: data?.filter((b) => b.status === 'completed') ?? [],
  };
}

/** A single booking by id. RLS makes sure only the customer / assigned driver / admin can read. */
export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: ['booking', id],
    enabled: !!id,
    queryFn: async (): Promise<DbBooking | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as DbBooking;
    },
  });
}

/** Call the bookings-create edge function. Server validates + records audit log. */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: any) => {
      const { data, error } = await supabase.functions.invoke('bookings-create', {
        body: input,
      });
      if (error) {
        // supabase-js wraps every non-2xx as FunctionsHttpError with the
        // useless message "Edge Function returned a non-2xx status code".
        // The real reason is in error.context (the raw Response). Read the
        // body and throw the actual server message so the customer-facing
        // toast tells them (and us) what's wrong instead of the wrapper.
        let detail: string | undefined;
        try {
          const ctx = (error as any).context;
          if (ctx?.json) {
            const body = await ctx.json();
            detail = body?.error ?? body?.message;
          } else if (ctx?.text) {
            detail = await ctx.text();
          }
        } catch {
          /* parsing failed — fall back to the wrapper message */
        }
        throw new Error(detail ?? error.message ?? 'Booking failed');
      }
      if (data?.error) throw new Error(data.error);
      return data?.booking;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
