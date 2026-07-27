// Mutation hooks that hit the booking lifecycle edge functions.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BookingStatus } from '@/types';

// ─── Customer-side booking modification ─────────────────────────────────────
//
// Edits an upcoming booking (>24h out, not in-flight). Deposit stays as-is
// because it's non-refundable per Movvy policy — modifications change the
// plan, not the commitment to pay.

export interface ModifyBookingArgs {
  booking_id: string;
  scheduled_for_date?: string;
  scheduled_for_window?: string;
  pickup?: {
    line1: string;
    city: string;
    region: string;
    country_code: string;
    postal?: string | null;
    lat: number;
    lng: number;
  };
  dropoff?: ModifyBookingArgs['pickup'] | null;
  details?: Record<string, any>;
  customer_notes?: string;
}

export function useModifyBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ModifyBookingArgs) => {
      const { data, error } = await supabase.functions.invoke('bookings-modify', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; booking: any };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['booking'] });
    },
  });
}

interface UpdateStatusArgs {
  booking_id: string;
  new_status: Exclude<BookingStatus, 'draft' | 'pending' | 'searching' | 'assigned' | 'confirmed' | 'failed'>;
  reason?: string;
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UpdateStatusArgs) => {
      const { data, error } = await supabase.functions.invoke('bookings-update-status', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data?.booking;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ booking_id, reason }: { booking_id: string; reason: string }) => {
      const { data, error } = await supabase.functions.invoke('bookings-cancel', {
        body: { booking_id, reason },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; refund_percent: number; refund_cents: number };
    },
    onSuccess: (_, vars) => {
      // Optimistically flip the cancelled row to 'cancelled' in every cached
      // bookings list RIGHT NOW so the derived useActiveBooking() stops
      // returning it and the Moves tab drops out of the live tracker
      // immediately — instead of waiting on a refetch that could race the
      // navigation and briefly leave the cancelled move showing as "active".
      qc.setQueriesData<any[]>({ queryKey: ['bookings'] }, (old) =>
        Array.isArray(old)
          ? old.map((b) => (b?.id === vars.booking_id ? { ...b, status: 'cancelled' } : b))
          : old,
      );
      qc.invalidateQueries({ queryKey: ['booking', vars.booking_id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useAcceptBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ booking_id, team_id, company_id }: { booking_id: string; team_id?: string; company_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('bookings-accept', {
        body: { booking_id, team_id, company_id },
      });
      if (error) {
        // supabase-js wraps every non-2xx as FunctionsHttpError whose message
        // is the useless "Edge Function returned a non-2xx status code". The
        // real reason ("Job was already taken", a verification gate, etc.)
        // lives in error.context (the raw Response) — surface it to the driver.
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
        throw new Error(detail ?? error.message ?? 'Could not accept this job');
      }
      if (data?.error) throw new Error(data.error);
      return data?.booking;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
