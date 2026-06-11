// =============================================================================
// Customer support hooks
//
// One module for every entry point on the Help & Support hub:
//   • useSos               — fires the support-sos edge fn
//   • useEnsureSupportThread — opens the customer↔admin chat thread
//   • useSubmitInsuranceClaim — files a claim via disputes-open (kind=insurance_claim)
//   • useSubmitDispute     — generic dispute (damage / theft / etc.)
//
// All four end up in the same chat_threads (kind='support') / disputes /
// audit_logs trail so admin only has to monitor those tables.
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

// ─── SOS ────────────────────────────────────────────────────────────────────

export interface SosArgs {
  booking_id: string;
  message?: string;
  lat?: number;
  lng?: number;
}

export interface SosResult {
  ok: true;
  recipients: number;
  emergency_sms_sent: boolean;
  police_notified: boolean;
  dispute_id: string | null;
  support_thread_id: string | null;
}

export function useSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SosArgs): Promise<SosResult> => {
      const { data, error } = await supabase.functions.invoke('support-sos', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as SosResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-disputes'] });
      qc.invalidateQueries({ queryKey: ['chat', 'threads'] });
    },
  });
}

// ─── Support thread bootstrap ──────────────────────────────────────────────

export function useEnsureSupportThread() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('ensure_support_thread');
      if (error) throw error;
      if (!data) throw new Error('Could not open support thread');
      return data as string;
    },
  });
}

// ─── Insurance claim ───────────────────────────────────────────────────────

export interface InsuranceClaimArgs {
  booking_id: string;
  summary: string;
  /** Optional photo paths already uploaded via documents-upload-url. */
  photoPaths?: string[];
  /** Damaged-items shortlist. Becomes part of the summary JSON. */
  items?: { label: string; estimatedValueDollars: number }[];
}

export function useSubmitInsuranceClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: InsuranceClaimArgs) => {
      // We embed the items + photo references into the summary text — the
      // existing disputes table stores everything in `summary` (no jsonb
      // column), and we don't want to widen the schema just for the
      // shortlist. Admin sees the bullets when they open the dispute.
      const itemsText =
        args.items && args.items.length > 0
          ? '\n\nDamaged items:\n' +
            args.items
              .map((i) => `• ${i.label} — est. $${i.estimatedValueDollars.toFixed(2)}`)
              .join('\n')
          : '';
      const photosText =
        args.photoPaths && args.photoPaths.length > 0
          ? '\n\nPhotos:\n' + args.photoPaths.map((p) => `• ${p}`).join('\n')
          : '';
      const summary = args.summary.trim() + itemsText + photosText;

      const { data, error } = await supabase.functions.invoke('disputes-open', {
        body: {
          booking_id: args.booking_id,
          kind: 'insurance_claim',
          severity: 'high',
          summary,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; dispute: { id: string } };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-disputes'] });
    },
  });
}

// ─── Generic dispute (damage / theft / poor service / …) ───────────────────

export interface DisputeArgs {
  booking_id: string;
  kind: 'damage' | 'late' | 'no_show' | 'poor_service' | 'overcharge' | 'other';
  severity?: 'low' | 'medium' | 'high';
  summary: string;
  photoPaths?: string[];
}

export function useSubmitFullDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: DisputeArgs) => {
      const photosText =
        args.photoPaths && args.photoPaths.length > 0
          ? '\n\nPhotos:\n' + args.photoPaths.map((p) => `• ${p}`).join('\n')
          : '';
      const { data, error } = await supabase.functions.invoke('disputes-open', {
        body: {
          booking_id: args.booking_id,
          kind: args.kind,
          severity: args.severity ?? 'medium',
          summary: args.summary.trim() + photosText,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; dispute: { id: string } };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-disputes'] });
    },
  });
}

// ─── Emergency contact in profile ──────────────────────────────────────────

export interface EmergencyContactArgs {
  name: string | null;
  /** E.164 format — validated by the DB constraint. */
  phone: string | null;
}

export function useUpdateEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: EmergencyContactArgs) => {
      if (!supabaseConfigured) throw new Error('Backend not configured');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in first');
      const { error } = await supabase
        .from('profiles')
        .update({
          emergency_contact_name: args.name?.trim() || null,
          emergency_contact_phone: args.phone?.trim() || null,
        })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}
