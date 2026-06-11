// =============================================================================
// useBookingAuditLog — read the booking's audit-log chain (customer or admin)
//
// Backed by the customer_booking_audit_log RPC (migration 0028) which is
// SECURITY DEFINER and authorises by booking ownership / driver assignment /
// admin role. Customers can read THEIR booking's chain without us opening
// audit_logs.RLS for them globally.
//
// useBookingAuditHash returns the SHA-256 of the canonical audit chain so
// the customer's exported PDF can be cross-referenced later — if any row
// in audit_logs changes, the hash on the exported document will no longer
// match a freshly-computed hash from the DB.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export interface BookingAuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_role: string | null;
  payload: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
}

export function useBookingAuditLog(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['booking-audit-log', bookingId],
    enabled: supabaseConfigured && !!bookingId,
    queryFn: async (): Promise<BookingAuditRow[]> => {
      const { data, error } = await supabase.rpc('customer_booking_audit_log', {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      return (data ?? []) as BookingAuditRow[];
    },
  });
}

export function useBookingAuditHash(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['booking-audit-hash', bookingId],
    enabled: supabaseConfigured && !!bookingId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('booking_audit_hash', {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });
}
