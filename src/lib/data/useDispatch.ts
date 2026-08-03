// =============================================================================
// Dispatch hooks (companies + drivers)
//
// useMyMembership      — which team/company the signed-in user belongs to,
//                        plus their role. Drives UI gating across the app
//                        (e.g. hide accept buttons for company drivers).
// useDispatchQueue     — the company's pending-action list (new requests +
//                        accepted-needs-driver). Calls the dispatch_queue() RPC.
// useCompanyDriverRoster — drivers in the company with their current job count.
// useDispatcherAccept / Assign / Decline — mutations against the three edge fns.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export type MembershipKind = 'company' | 'team' | null;
export type MembershipRole =
  | 'owner'
  | 'dispatcher'
  | 'driver'
  | 'mover'
  | null;

/** The unified two-tier org role (migration 0066). `admin` runs the org —
 *  accepts jobs, assigns crew, sees pricing/revenue, onboards/removes. `crew`
 *  performs assigned moves and never sees dollars. This is the value the app
 *  should gate on going forward; the legacy `role` (owner/driver) is kept only
 *  for back-compat. */
export type OrgRole = 'admin' | 'crew' | null;

export interface Membership {
  kind: MembershipKind;
  role: MembershipRole;
  org_role: OrgRole;
  company_id: string | null;
  team_id: string | null;
  company_name: string | null;
  team_name: string | null;
  /** True for company DRIVERS — they can't accept jobs themselves. */
  is_company_driver: boolean;
  /** True for hourly/salaried laborers — company drivers AND team movers.
   *  They work a dispatched shift: they don't accept jobs, and the
   *  estimated job revenue/payout is hidden from them (they're paid a wage,
   *  not per move). The operator who DOES earn per move — a solo/2-person
   *  team's driver, or a company owner/dispatcher — has is_hourly = false. */
  is_hourly: boolean;
  /** The city the team / company operates in. Used to scope the
   *  available-jobs feed + the new-job popup to the partner's market
   *  instead of hardcoding 'calgary' everywhere. Null when the user has
   *  no partner membership (pure customer). */
  city_id: string | null;
  city_slug: string | null;
  city_name: string | null;
  /** 2-letter province/region code for the operating city (e.g. 'AB'). Used
   *  for the company dashboard subtitle so it reads the real market instead of
   *  a hardcoded "Calgary, AB". */
  city_region: string | null;
}

/**
 * Maps a partner's membership to the on-behalf-of id that bookings-accept
 * requires. Solo / 2-person crews accept as their team; company owners &
 * dispatchers as their company. Returns null when membership hasn't resolved
 * yet (or the caller has no partner membership) so the UI can bail before
 * firing a request the edge function would reject.
 */
export function acceptOnBehalfOf(
  membership: Membership | null | undefined,
): { team_id: string } | { company_id: string } | null {
  if (membership?.kind === 'company' && membership.company_id) {
    return { company_id: membership.company_id };
  }
  if (membership?.kind === 'team' && membership.team_id) {
    return { team_id: membership.team_id };
  }
  return null;
}

/**
 * Resolve the signed-in user's partner membership in one round-trip.
 * Returns nulls when the user isn't part of any partner — e.g. they're a
 * pure customer.
 */
export function useMyMembership() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-membership', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    // Poll so a role change (promote/demote by an admin) is picked up within a
    // few seconds and the role-surface banner can react live.
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Membership> => {
      const empty: Membership = {
        kind: null,
        role: null,
        org_role: null,
        company_id: null,
        team_id: null,
        company_name: null,
        team_name: null,
        is_company_driver: false,
        is_hourly: false,
        city_id: null,
        city_slug: null,
        city_name: null,
        city_region: null,
      };

      // Look for a company membership first. We pull the company's
      // primary_city_id + the joined city slug so downstream feeds can
      // scope jobs to the right market instead of hardcoding 'calgary'.
      const { data: memberships } = await supabase
        .from('company_members')
        .select(
          'company_id, role, org_role, companies!inner(display_name, primary_city_id, cities:primary_city_id(slug, name, region))',
        )
        .eq('profile_id', user!.id)
        .eq('status', 'active')
        .is('removed_at', null);
      // A person can belong to two orgs at once: their OWN (org_role='admin',
      // created at signup) and a crew they JOINED (org_role='crew'). When
      // they've joined someone, that's the context they're working in — prefer
      // it. Otherwise they're running solo under their own org.
      const company =
        (memberships ?? []).find((m: any) => m.org_role === 'crew') ??
        (memberships ?? [])[0] ??
        null;
      if (company) {
        const c: any = (company as any).companies;
        // Merged model: org_role is the source of truth. `crew` are the hourly
        // laborers who don't see per-move revenue; `admin` runs the org.
        const orgRole = ((company as any).org_role ?? null) as OrgRole;
        return {
          kind: 'company',
          role: company.role as MembershipRole,
          org_role: orgRole,
          company_id: company.company_id,
          team_id: null,
          company_name: c?.display_name ?? null,
          team_name: null,
          is_company_driver: orgRole === 'crew',
          is_hourly: orgRole === 'crew',
          city_id: c?.primary_city_id ?? null,
          city_slug: c?.cities?.slug ?? null,
          city_name: c?.cities?.name ?? null,
          city_region: c?.cities?.region ?? null,
        };
      }

      // Otherwise try a team membership
      const { data: team } = await supabase
        .from('partner_team_members')
        .select(
          'team_id, role, partner_teams!inner(display_name, primary_city_id, cities:primary_city_id(slug, name, region))',
        )
        .eq('profile_id', user!.id)
        .eq('status', 'active')
        .is('removed_at', null)
        .limit(1)
        .maybeSingle();
      if (team) {
        const t: any = (team as any).partner_teams;
        // Legacy path — partner_teams were migrated into companies in
        // migration 0068 and retired, so this no longer resolves for real
        // users. Kept compiling for safety during the transition.
        return {
          kind: 'team',
          role: team.role as MembershipRole,
          org_role: team.role === 'mover' ? 'crew' : 'admin',
          company_id: null,
          team_id: team.team_id,
          company_name: null,
          team_name: t?.display_name ?? null,
          is_company_driver: false,
          // A team's MOVER is an hourly helper; the team's DRIVER is the
          // operator who accepts jobs and earns the per-move revenue.
          is_hourly: team.role === 'mover',
          city_id: t?.primary_city_id ?? null,
          city_slug: t?.cities?.slug ?? null,
          city_name: t?.cities?.name ?? null,
          city_region: t?.cities?.region ?? null,
        };
      }

      return empty;
    },
  });
}

// ─── Dispatcher queue ────────────────────────────────────────────────────────

export type DispatchBucket = 'new_request' | 'needs_driver';

export interface DispatchQueueRow {
  id: string;
  short_code: string;
  status: string;
  move_type: string;
  pickup_line1: string;
  pickup_city: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  /** Precise UTC moment the move's window begins — used to compute the
   *  "Starts in 47m" red urgency pill in the dispatch UI. */
  scheduled_for_window_starts_at: string | null;
  price_total_cents: number;
  customer_id: string;
  assigned_driver_profile_id: string | null;
  dispatch_accepted_at: string | null;
  created_at: string;
  bucket: DispatchBucket;
}

export function useDispatchQueue(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['dispatch-queue', companyId],
    enabled: !!companyId && supabaseConfigured,
    refetchInterval: 8000, // dispatch is time-sensitive — poll every 8s
    queryFn: async (): Promise<DispatchQueueRow[]> => {
      const { data, error } = await supabase.rpc('dispatch_queue', {
        p_company_id: companyId!,
      });
      if (error) throw error;
      return (data ?? []) as DispatchQueueRow[];
    },
  });
}

// ─── Org open-job feed (pricing-gated) ───────────────────────────────────────
// The merged-model feed EVERY member sees — admin and crew alike. Backed by the
// org_open_jobs() RPC (migration 0067): move details for the unassigned pool
// within range of the org's base city, with the dollar columns populated ONLY
// for admins (crew receive null, enforced server-side). Any member can then
// accept via dispatch-accept; only an admin assigns the performer.

export interface OrgOpenJob {
  id: string;
  short_code: string;
  status: string;
  move_type: string;
  pickup_line1: string;
  pickup_city: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  scheduled_for_window_starts_at: string | null;
  customer_id: string;
  distance_km: number;
  /** Null for crew — the pricing gate lives in the RPC, not the UI. */
  price_total_cents: number | null;
  driver_total_cents: number | null;
  /** Capacity: what this move needs vs the biggest truck this org has. */
  required_truck_ft: number;
  required_crew: number;
  my_max_truck_ft: number;
  bedrooms: number;
  dwelling: string;
}

export function useOrgOpenJobs(radiusKm = 60) {
  return useQuery({
    queryKey: ['org-open-jobs', radiusKm],
    enabled: supabaseConfigured,
    refetchInterval: 10000, // new jobs surface for the whole org quickly
    queryFn: async (): Promise<OrgOpenJob[]> => {
      const { data, error } = await supabase.rpc('org_open_jobs', { p_radius_km: radiusKm });
      if (error) throw error;
      return (data ?? []) as OrgOpenJob[];
    },
  });
}

// ─── Company driver roster ───────────────────────────────────────────────────

export interface CompanyDriverRosterRow {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  driver_license_number: string | null;
  active_jobs: number;
  /** True iff the driver toggled online AND was last seen within 30 min. */
  is_online: boolean;
  last_online_at: string | null;
}

export function useCompanyDriverRoster(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['company-driver-roster', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<CompanyDriverRosterRow[]> => {
      const { data, error } = await supabase.rpc('company_drivers_roster', {
        p_company_id: companyId!,
      });
      if (error) throw error;
      return (data ?? []) as CompanyDriverRosterRow[];
    },
  });
}

// ─── Independent-operator crew (partner_team) ────────────────────────────────
// The team analog of the company driver roster. Lets a solo/independent
// operator (the team's driver) build and manage a small crew of hourly movers,
// mirroring the company multi-driver experience. Backed by the
// partner_team_roster() RPC (migration 0040), gated on team membership.

export interface PartnerTeamRosterRow {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** 'driver' = the operator who accepts jobs & earns; 'mover' = hourly crew. */
  role: 'driver' | 'mover';
  driver_license_number: string | null;
  /** Count of the team's in-flight bookings — lights up "On job" for all crew. */
  active_jobs: number;
  /** True iff the member toggled online AND was last seen within 30 min. */
  is_online: boolean;
  last_online_at: string | null;
}

export function usePartnerTeamRoster(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ['partner-team-roster', teamId],
    enabled: !!teamId && supabaseConfigured,
    queryFn: async (): Promise<PartnerTeamRosterRow[]> => {
      const { data, error } = await supabase.rpc('partner_team_roster', {
        p_team_id: teamId!,
      });
      if (error) throw error;
      return (data ?? []) as PartnerTeamRosterRow[];
    },
  });
}

export interface MyTeam {
  id: string;
  display_name: string | null;
  /** Auto-generated invite code (e.g. "TM-K4P2QH") the operator shares. */
  invite_code: string | null;
  rating_avg: number | null;
  rating_count: number;
  verified_at: string | null;
}

// The operator's own team row — readable directly via the
// partner_teams_member_read RLS policy (any team member can read their team).
// Surfaces display_name + invite_code for the Crew screen header.
export function useMyTeam(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ['my-team', teamId],
    enabled: !!teamId && supabaseConfigured,
    queryFn: async (): Promise<MyTeam | null> => {
      const { data, error } = await supabase
        .from('partner_teams')
        .select('id, display_name, invite_code, rating_avg, rating_count, verified_at')
        .eq('id', teamId!)
        .maybeSingle();
      if (error) throw error;
      return (data as MyTeam | null) ?? null;
    },
  });
}

// ─── Dispatcher mutations ────────────────────────────────────────────────────

export function useDispatcherAccept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { booking_id: string; company_id: string }) => {
      const { data, error } = await supabase.functions.invoke('bookings-dispatch-accept', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; booking: { id: string; short_code: string; status: string } };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dispatch-queue', vars.company_id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useDispatcherAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      booking_id: string;
      company_id: string;
      driver_profile_id: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('bookings-dispatch-assign', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; booking: any };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dispatch-queue', vars.company_id] });
      qc.invalidateQueries({ queryKey: ['company-driver-roster', vars.company_id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['my-current-job'] });
    },
  });
}

// ─── Driver presence (online/offline) ───────────────────────────────────────
// Drivers toggle their availability from (mover)/jobs.tsx. The toggle was
// previously client-state-only — now it writes through via set_my_presence
// so the matcher + the company assign-driver picker can see it.

export function useSetMyPresence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (online: boolean) => {
      const { error } = await supabase.rpc('set_my_presence', { p_online: online });
      if (error) throw error;
      return online;
    },
    onSuccess: () => {
      // Roster + queue might read presence — refetch on the next idle tick.
      qc.invalidateQueries({ queryKey: ['company-driver-roster'] });
      qc.invalidateQueries({ queryKey: ['my-online-state'] });
    },
  });
}

// Read the driver's server-side online flag so the Jobs-tab toggle reflects
// the actual partner_drivers.is_online value on cold start — not just a
// hardcoded `useState(true)` that silently flips offline shifts back on.
export function useMyOnlineState() {
  return useQuery({
    queryKey: ['my-online-state'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from('partner_drivers')
        .select('is_online')
        .eq('profile_id', user.id)
        .maybeSingle();
      return data?.is_online ?? false;
    },
  });
}

// ─── Company-wide jobs (for the Jobs tab) ──────────────────────────────────
// Returns every booking the company has touched, regardless of status.
// Used on (company)/jobs.tsx so dispatchers can see Inbox / Assigned /
// Completed without having to action them individually.

export interface CompanyJobRow {
  id: string;
  short_code: string;
  status: string;
  move_type: string;
  pickup_line1: string;
  pickup_city: string;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  scheduled_for_window_starts_at: string | null;
  price_total_cents: number;
  assigned_driver_profile_id: string | null;
  customer_id: string;
  created_at: string;
}

export function useCompanyJobs(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['company-jobs', companyId],
    enabled: !!companyId && supabaseConfigured,
    refetchInterval: 30_000,
    queryFn: async (): Promise<CompanyJobRow[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, short_code, status, move_type, pickup_line1, pickup_city, dropoff_line1, dropoff_city, scheduled_for_date, scheduled_for_window, scheduled_for_window_starts_at, price_total_cents, assigned_driver_profile_id, customer_id, created_at',
        )
        .eq('assigned_company_id', companyId!)
        .order('scheduled_for_window_starts_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as CompanyJobRow[];
    },
  });
}

export function useDispatcherDecline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { booking_id: string; company_id: string; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke('bookings-dispatch-decline', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; action: 'noted' | 'released'; booking?: any };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dispatch-queue', vars.company_id] });
    },
  });
}

// ─── Option C: pending-approval self-join flow ───────────────────────────────
// Anyone with a valid team/company invite code can sign up and self-join —
// they land in status='pending_approval'. The three hooks below drive both
// sides of the approval handshake:
//   • usePendingApprovalMembership — the applicant's "you're in the queue"
//     waiting screen (polls until the owner approves/rejects).
//   • usePendingJoinRequests — the owner's crew/drivers "Pending approvals"
//     list.
//   • useResolveJoinRequest — the owner's Approve / Reject button.

export interface PendingApprovalMembership {
  kind: 'team' | 'company';
  subject_id: string;
  org_name: string | null;
  member_role: string;
  status: 'pending_approval' | 'rejected';
  rejected_reason: string | null;
}

/**
 * The signed-in user's OWN pending/rejected membership, if any. Returns null
 * when they have no pending membership (i.e. they're active or a pure
 * customer). Polls every 15s so the waiting screen flips to the dashboard
 * within seconds of the owner approving. Backed by my_pending_membership()
 * (SECURITY DEFINER — reads the org name that tightened RLS now hides).
 */
export function usePendingApprovalMembership() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-pending-membership', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    refetchInterval: 15_000,
    queryFn: async (): Promise<PendingApprovalMembership | null> => {
      const { data, error } = await supabase.rpc('my_pending_membership');
      if (error) throw error;
      const row = (data ?? [])[0];
      return (row as PendingApprovalMembership | undefined) ?? null;
    },
  });
}

export interface PendingJoinRequest {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  member_role: string;
  requested_at: string;
}

/**
 * The pending applicants waiting for the owner to approve them into their
 * team/company. Gated server-side — only an active owner/dispatcher (company)
 * or active operator (team) sees rows. Polls every 20s so a new self-join
 * shows up without a manual refresh.
 */
export function usePendingJoinRequests(
  kind: 'team' | 'company' | null | undefined,
  subjectId: string | null | undefined,
) {
  return useQuery({
    queryKey: ['pending-join-requests', kind, subjectId],
    enabled: !!kind && !!subjectId && supabaseConfigured,
    refetchInterval: 20_000,
    queryFn: async (): Promise<PendingJoinRequest[]> => {
      const { data, error } = await supabase.rpc('pending_join_requests', {
        p_kind: kind!,
        p_subject_id: subjectId!,
      });
      if (error) throw error;
      return (data ?? []) as PendingJoinRequest[];
    },
  });
}

/**
 * Approve or reject a pending join request. Invokes partners-approve-join,
 * which flips the member row to active/rejected, notifies the applicant, and
 * audit-logs the decision. Invalidates the owner's pending list + roster so
 * the approved driver appears in the crew immediately.
 */
export function useResolveJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      subject_type: 'team' | 'company';
      subject_id: string;
      applicant_profile_id: string;
      decision: 'approve' | 'reject';
      reason?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('partners-approve-join', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        ok: true;
        decision: 'approve' | 'reject';
        applicant_name: string;
        target_name: string;
      };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pending-join-requests', vars.subject_type, vars.subject_id] });
      qc.invalidateQueries({ queryKey: ['company-driver-roster', vars.subject_id] });
      qc.invalidateQueries({ queryKey: ['partner-team-roster', vars.subject_id] });
    },
  });
}
