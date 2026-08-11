import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';
import type { TeamMember } from '@/store/partnerStore';
import type { CompanyDriver } from '@/store/partnerStore';

interface CreateTeamArgs {
  citySlug: string;
  driver: TeamMember;
  mover: TeamMember;
}

/**
 * RETIRED. Do not use.
 *
 * This created a `partner_teams` row plus `partner_team_members`, the model that
 * was replaced by `companies` + `company_members` when the org model merged
 * (0068). Both old tables are empty in production and nothing reads them.
 *
 * Its only caller is /(mover)/onboarding/documents.tsx, and that flow is
 * unreachable: app/partner.tsx routes EVERY partner signup — solo crew and
 * company alike — to /(company)/onboarding/operator. The comment there still
 * mentioning /(mover)/onboarding/personal is stale.
 *
 * It is not repointed at `companies` on purpose. Doing so would half-migrate an
 * orphaned flow — the member insert targets a different table with a different
 * shape — and produce an org that exists but doesn't behave like one. Instead it
 * now throws, so if anything ever does reach this path we hear about it rather
 * than silently creating a partner nobody can see, pay, or dispatch.
 */
export function useCreatePartnerTeam() {
  return useMutation({
    mutationFn: async (_args: CreateTeamArgs): Promise<{ id: string; invite_code: string }> => {
      throw new Error(
        'Partner signup has moved. This screen writes to the retired partner_teams ' +
        'model — use the company onboarding flow instead.',
      );
    },
  });
}



interface CreateCompanyArgs {
  legal_name: string;
  display_name: string;
  registration_number: string;
  phone: string;
  email: string;
  citySlug: string;
  hq: { line1: string; city: string; region: string; postal?: string; country_code: string; lat: number; lng: number };
  truck_count: number;
  drivers: CompanyDriver[];
}

export function useCreateCompany() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateCompanyArgs) => {
      if (!user) throw new Error('Not signed in');

      const { data: city, error: cityErr } = await supabase
        .from('cities').select('id').eq('slug', args.citySlug).single();
      if (cityErr || !city) throw new Error('City not found');

      // Insert + read back the auto-generated invite_code (set by the
      // companies_invite_code trigger in migration 0016).
      const { data: company, error: cErr } = await supabase
        .from('companies')
        .insert({
          legal_name: args.legal_name,
          display_name: args.display_name,
          registration_number: args.registration_number,
          phone: args.phone,
          email: args.email,
          primary_city_id: city.id,
          hq_line1: args.hq.line1,
          hq_city_name: args.hq.city,
          hq_region: args.hq.region,
          hq_country_code: args.hq.country_code,
          hq_postal: args.hq.postal ?? null,
          hq_lat: args.hq.lat,
          hq_lng: args.hq.lng,
          onboarding_status: 'in_progress',
          truck_count: args.truck_count,
        })
        .select('id, invite_code')
        .single();
      if (cErr || !company) throw cErr ?? new Error('Could not create company');

      // Signed-in user becomes owner
      const { error: memErr } = await supabase
        .from('company_members')
        .insert({ company_id: company.id, profile_id: user.id, role: 'owner', accepted_at: new Date().toISOString() });
      if (memErr) throw memErr;

      qc.invalidateQueries({ queryKey: ['my-companies'] });
      return company as { id: string; invite_code: string };
    },
  });
}

// ─── Driver-side stats ─────────────────────────────────────────────────────
//
// Look up the partner team(s) the signed-in user belongs to as a driver and
// surface aggregate rating + trip counts. The `rating_avg` / `rating_count`
// columns are kept fresh by a DB trigger (refresh_partner_team_rating, see
// migration 0006), so reads here are O(1) — no aggregation in the client.

export interface DriverStats {
  /** 0–5 star average across every customer rating, null if no ratings yet. */
  rating_avg: number | null;
  /** Total number of customer ratings received. */
  rating_count: number;
  /** Completed bookings — the lifetime "trips" figure shown next to the rating. */
  trip_count: number;
  /** Partner team display name — the brand the driver is moving under. */
  team_name: string | null;
  /** Onboarding state — used to gate certain UI ("Verified" badge etc). */
  onboarding_status: string | null;
}

export function useMyDriverStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-driver-stats', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<DriverStats> => {
      // 1) Find the org this profile belongs to. Reads company_members +
      //    companies: this used to join partner_team_members → partner_teams,
      //    both retired and empty since 0068, so `membership` was ALWAYS null
      //    and every crew member saw the zeroed fallback below — no rating, no
      //    trip count, no crew name — as though they'd never done a move.
      const { data: membership, error: mErr } = await supabase
        .from('company_members')
        .select('company_id, companies!inner(id, display_name, rating_avg, rating_count, onboarding_status)')
        .eq('profile_id', user!.id)
        .eq('status', 'active')
        .is('removed_at', null)
        .limit(1)
        .maybeSingle();
      if (mErr) throw mErr;

      // No org yet (still onboarding) — show zeroed stats so UI renders fine.
      if (!membership) {
        return { rating_avg: null, rating_count: 0, trip_count: 0, team_name: null, onboarding_status: null };
      }
      const team = (membership as any).companies;

      // 2) Count completed bookings assigned to this team. We use a head-count
      //    query so we don't pull row data we don't need.
      const { count, error: cErr } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        // assigned_company_id, not assigned_team_id — jobs are accepted by
        // companies now, so the old column is never set and the trip count was
        // permanently zero.
        .eq('assigned_company_id', team.id)
        .eq('status', 'completed');
      if (cErr) throw cErr;

      return {
        rating_avg: team.rating_avg as number | null,
        rating_count: team.rating_count ?? 0,
        trip_count: count ?? 0,
        team_name: team.display_name as string | null,
        onboarding_status: team.onboarding_status as string | null,
      };
    },
  });
}

// ─── Team profile editor (operator-side) ───────────────────────────────────
//
// The org's editable settings, read and written against `companies`. Named
// "Team" for history only — partner_teams is retired (0068). Used by the
// Service area editor; the Bank and Tax editors it also fed have been removed
// from the mover profile, because payouts settle to the crew ADMIN's details.

export interface TeamRow {
  id: string;
  display_name: string | null;
  invite_code: string | null;
  primary_city_id: string;
  service_radius_km: number;
  onboarding_status: string;
  verified_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  stripe_account_id: string | null;
  payout_currency: string;
  bank_holder_name: string | null;
  bank_institution_number: string | null;
  bank_transit_number: string | null;
  bank_account_last4: string | null;
  bank_updated_at: string | null;
  /** companies has no gst_number — the tax editor that used it is retired. */
  etransfer_email: string | null;
}

const TEAM_KEY = (id: string | null | undefined) => ['team-full', id] as const;

export function useTeam(teamId: string | null | undefined) {
  return useQuery({
    queryKey: TEAM_KEY(teamId),
    enabled: !!teamId && supabaseConfigured,
    queryFn: async (): Promise<TeamRow | null> => {
      // `companies`, not `partner_teams`. The teams table was retired when the
      // org model merged (0068) and is empty in production — every read here
      // returned null, so the crew's own bank details, service area and rating
      // rendered blank on a screen that looked like it had simply never been
      // filled in. `gst_number` is dropped from the select: it exists only on
      // the old table, and the tax editor that used it is gone.
      const { data, error } = await supabase
        .from('companies')
        .select(
          'id, display_name, invite_code, primary_city_id, service_radius_km, onboarding_status, verified_at, rating_avg, rating_count, stripe_account_id, payout_currency, bank_holder_name, bank_institution_number, bank_transit_number, bank_account_last4, bank_updated_at, etransfer_email',
        )
        .eq('id', teamId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TeamRow | null;
    },
  });
}

export function useUpdateTeam(teamId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TeamRow>) => {
      if (!teamId) throw new Error('No team id');
      // Writes went to the retired, empty `partner_teams` table: the update
      // matched zero rows, reported success, and the data was gone. That is how
      // a crew could enter their banking details, see them saved, and have them
      // never reach the payouts console.
      const { error } = await supabase.from('companies').update(patch).eq('id', teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY(teamId) });
      qc.invalidateQueries({ queryKey: ['my-team', teamId] });
      qc.invalidateQueries({ queryKey: ['my-membership'] });
      qc.invalidateQueries({ queryKey: ['my-driver-stats'] });
    },
  });
}

// ─── Driver's own vehicle ──────────────────────────────────────────────────
//
// Vehicles RLS gates "owner full access via owner_profile_id". We keep one
// row per driver — the editor upserts on the unique (plate, province) index
// when replacing, but in practice the operator edits the same row.

export interface DriverVehicleRow {
  id: string;
  owner_profile_id: string | null;
  type:
    | 'cargo_van'
    | 'cube_van_16'
    | 'box_truck_24'
    | 'box_truck_26'
    | 'pickup_truck'
    | 'other';
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string;
  province: string;
  capacity_cu_ft: number | null;
}

export function useMyDriverVehicle() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-driver-vehicle', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<DriverVehicleRow | null> => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, owner_profile_id, type, make, model, year, plate, province, capacity_cu_ft')
        .eq('owner_profile_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DriverVehicleRow | null;
    },
  });
}

export function useSaveMyDriverVehicle() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string | null;
      type: DriverVehicleRow['type'];
      make: string;
      model: string;
      year?: number | null;
      plate: string;
      province: string;
      capacity_cu_ft?: number | null;
    }) => {
      if (!user) throw new Error('Not signed in');
      const payload = {
        owner_profile_id: user.id,
        type: input.type,
        make: input.make.trim() || null,
        model: input.model.trim() || null,
        year: input.year ?? null,
        plate: input.plate.toUpperCase().trim(),
        province: input.province.toUpperCase().trim(),
        capacity_cu_ft: input.capacity_cu_ft ?? null,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('vehicles')
          .update(payload)
          .eq('id', input.id)
          .select('*')
          .single();
        if (error) throw error;
        return data as DriverVehicleRow;
      }
      const { data, error } = await supabase
        .from('vehicles')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;
      return data as DriverVehicleRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-driver-vehicle', user?.id] });
    },
  });
}

// ─── Driver verification documents ─────────────────────────────────────────
//
// Combined view of every verification_documents row a driver can see — their
// own (profile-scoped) plus their team's. Used by the Documents editor in
// the mover profile to surface review status + re-upload affordances.

export interface DriverDocRow {
  id: string;
  kind: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  storage_path: string;
  mime_type: string | null;
  expires_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  /** Subject the doc is attached to. Drives the upload re-route on replace. */
  scope: 'profile' | 'team';
}

export function useMyDriverDocuments(teamId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-driver-documents', user?.id, teamId],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<DriverDocRow[]> => {
      // Two queries — RLS treats the two subjects as disjoint paths
      // (vd_subject_select gates on EITHER profile_id OR team_id). We tag
      // each result with a scope so the UI knows where to re-upload.
      const profilePromise = supabase
        .from('verification_documents')
        .select(
          'id, kind, status, storage_path, mime_type, expires_at, created_at, reviewed_at, rejection_reason',
        )
        .eq('profile_id', user!.id)
        .order('created_at', { ascending: false });
      const teamPromise = teamId
        ? supabase
            .from('verification_documents')
            .select(
              'id, kind, status, storage_path, mime_type, expires_at, created_at, reviewed_at, rejection_reason',
            )
            .eq('team_id', teamId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as any[], error: null });
      const [{ data: pData, error: pErr }, { data: tData, error: tErr }] = await Promise.all([
        profilePromise,
        teamPromise,
      ]);
      if (pErr) throw pErr;
      if (tErr) throw tErr;
      return [
        ...((pData ?? []).map((r: any) => ({ ...r, scope: 'profile' as const })) as DriverDocRow[]),
        ...((tData ?? []).map((r: any) => ({ ...r, scope: 'team' as const })) as DriverDocRow[]),
      ];
    },
  });
}
