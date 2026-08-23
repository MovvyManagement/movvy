// =============================================================================
// useCompany / useUpdateCompany / useCompanyVehicles / useCompanyDocuments
//
// Single source of truth for the company-side Profile editors. Reads the
// full companies row (RLS lets members select it) and exposes a mutation
// that writes only the fields the editor touched. Owners + dispatchers can
// update; drivers can read.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export interface CompanyRow {
  id: string;
  legal_name: string;
  display_name: string;
  registration_number: string;
  phone: string;
  email: string;
  primary_city_id: string;
  hq_line1: string;
  hq_line2: string | null;
  hq_city_name: string;
  hq_region: string;
  hq_country_code: string;
  hq_postal: string | null;
  hq_lat: number;
  hq_lng: number;
  onboarding_status: string;
  verified_at: string | null;
  service_radius_km: number;
  truck_count: number;
  rating_avg: number | null;
  rating_count: number;
  stripe_account_id: string | null;
  payout_currency: string;
  invite_code: string;
  bank_institution_number: string | null;
  bank_transit_number: string | null;
  bank_account_last4: string | null;
  bank_holder_name: string | null;
  bank_updated_at: string | null;
}

const COMPANY_KEY = (id: string | null | undefined) => ['company', id] as const;

export function useCompany(companyId: string | null | undefined) {
  return useQuery({
    queryKey: COMPANY_KEY(companyId),
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<CompanyRow | null> => {
      // Columns named explicitly, not '*'. The five payment-destination
      // columns are revoked from `authenticated` (0119) because RLS is
      // row-level and the members-can-read policy therefore exposed a crew's
      // bank details to every hourly member. PostgREST expands '*' to the
      // whole table and fails with 42501 when any column is revoked, so a
      // star select here would break this query for admins too.
      //
      // Bank details come from my_company_bank_details() instead — see
      // useMyCompanyBankDetails below.
      const { data, error } = await supabase
        .from('companies')
        .select(
          'id, legal_name, display_name, registration_number, phone, email, ' +
          'primary_city_id, service_radius_km, truck_count, invite_code, ' +
          'onboarding_status, verified_at, suspended_at, suspended_reason, ' +
          'background_check_status, background_check_completed_at, ' +
          'rating_avg, rating_count, hq_line1, hq_line2, hq_city_name, ' +
          'hq_region, hq_postal, hq_country_code, hq_lat, hq_lng, ' +
          'stripe_account_id, payout_currency, bank_updated_at, ' +
          'created_at, updated_at, deleted_at',
        )
        .eq('id', companyId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CompanyRow | null;
    },
  });
}

export function useUpdateCompany(companyId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<CompanyRow>) => {
      if (!companyId) throw new Error('No company id');
      const { error } = await supabase.from('companies').update(patch).eq('id', companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMPANY_KEY(companyId) });
      qc.invalidateQueries({ queryKey: ['my-membership'] });
    },
  });
}

// ─── Vehicles (trucks) ─────────────────────────────────────────────────────

export interface VehicleRow {
  id: string;
  company_id: string | null;
  owner_profile_id: string | null;
  type: 'cargo_van' | 'cube_van_16' | 'box_truck_24' | 'box_truck_26' | 'pickup_truck' | 'other';
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string;
  province: string;
  capacity_cu_ft: number | null;
  length_ft: number | null;
  created_at: string;
}

export function useCompanyVehicles(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['company-vehicles', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<VehicleRow[]> => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as VehicleRow[];
    },
  });
}

export function useAddCompanyVehicle(companyId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: VehicleRow['type'];
      make: string;
      model: string;
      year?: number | null;
      plate: string;
      province: string;
      capacity_cu_ft?: number | null;
      length_ft?: number | null;
    }) => {
      if (!companyId) throw new Error('No company id');
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          company_id: companyId,
          type: input.type,
          make: input.make,
          model: input.model,
          year: input.year ?? null,
          plate: input.plate.toUpperCase().trim(),
          province: input.province.toUpperCase().trim(),
          capacity_cu_ft: input.capacity_cu_ft ?? null,
          length_ft: input.length_ft ?? null,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data as VehicleRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-vehicles', companyId] });
    },
  });
}

export function useDeleteCompanyVehicle(companyId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: string) => {
      const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-vehicles', companyId] });
    },
  });
}

// ─── Verification documents (company-side) ─────────────────────────────────
// Used by the Business Registration + Insurance editors to surface which
// docs are on file and what their review status is.

export interface CompanyDocRow {
  id: string;
  kind: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  storage_path: string;
  mime_type: string | null;
  expires_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export function useCompanyDocuments(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['company-documents', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<CompanyDocRow[]> => {
      const { data, error } = await supabase
        .from('verification_documents')
        .select(
          'id, kind, status, storage_path, mime_type, expires_at, created_at, reviewed_at, rejection_reason',
        )
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompanyDocRow[];
    },
  });
}

// ─── Company payouts (Invoices screen) ─────────────────────────────────────

export interface CompanyPayoutRow {
  id: string;
  booking_id: string;
  gross_cents: number;
  movvy_margin_cents: number;
  net_cents: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  scheduled_for: string | null;
  paid_at: string | null;
  created_at: string;
  booking: { short_code: string | null; scheduled_for_date: string | null } | null;
}

export function useCompanyPayouts(companyId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['company-payouts', companyId, user?.id],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<CompanyPayoutRow[]> => {
      const { data, error } = await supabase
        .from('driver_payouts')
        .select(
          'id, booking_id, gross_cents, movvy_margin_cents, net_cents, status, scheduled_for, paid_at, created_at, booking:bookings(short_code, scheduled_for_date)',
        )
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      // PostgREST returns the nested booking as either an array or object
      // depending on FK inference — normalise to a single object.
      return (data ?? []).map((r: any) => ({
        ...r,
        booking: Array.isArray(r.booking) ? r.booking[0] ?? null : r.booking,
      })) as CompanyPayoutRow[];
    },
  });
}

/**
 * The caller's own crew payment destination — org admins only.
 *
 * Separate from useCompany because the bank columns are no longer readable
 * from the table: a crew member could read their admin's holder name,
 * institution, transit and account tail straight off `companies`, which RLS
 * could not prevent because it grants rows, not columns. my_company_bank_details()
 * (0119) checks org_role = 'admin' and returns nothing to anyone else.
 */
export function useMyCompanyBankDetails(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['company-bank-details', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_company_bank_details');
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        company_id: string;
        bank_holder_name: string | null;
        bank_institution_number: string | null;
        bank_transit_number: string | null;
        bank_account_last4: string | null;
        etransfer_email: string | null;
        bank_updated_at: string | null;
      }>;
      return rows.find((r) => r.company_id === companyId) ?? null;
    },
  });
}
