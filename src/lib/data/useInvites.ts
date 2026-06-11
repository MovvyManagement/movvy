// =============================================================================
// Partner invite hooks
//
// useSendPartnerInvites — owner submits a list of crew contacts; the edge
//   function inserts partner_invites rows + dispatches SMS/email per entry.
// useAcceptPartnerInvite — invitee enters their invite code + contact +
//   chosen password; the edge function creates / links their auth user.
// useTeamInvites — list pending/sent/accepted invites for the owner's team
//   so the share screen shows the roster and lets them re-send.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

export type PartnerInviteRole = 'driver' | 'mover' | 'dispatcher';

export interface PartnerInviteEntry {
  full_name?: string;
  role: PartnerInviteRole;
  email?: string;
  phone?: string; // E.164
}

export interface SendInvitesArgs {
  team_id?: string;
  company_id?: string;
  invites: PartnerInviteEntry[];
}

export interface SendInvitesResult {
  ok: true;
  invite_code: string;
  results: Array<{
    email?: string;
    phone?: string;
    role: PartnerInviteRole;
    status: 'sent' | 'failed';
    channel: 'sms' | 'email' | 'both' | null;
    error?: string;
  }>;
}

export function useSendPartnerInvites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SendInvitesArgs): Promise<SendInvitesResult> => {
      const { data, error } = await supabase.functions.invoke('partners-invite-send', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as SendInvitesResult;
    },
    onSuccess: (_, vars) => {
      // Refetch the invite list for whichever recipient we just invited into
      if (vars.team_id) qc.invalidateQueries({ queryKey: ['team-invites', vars.team_id] });
      if (vars.company_id) qc.invalidateQueries({ queryKey: ['company-invites', vars.company_id] });
    },
  });
}

export interface AcceptInviteArgs {
  invite_code: string;
  email?: string;
  phone?: string;
  password: string;
  full_name: string;
}

export interface AcceptInviteResult {
  ok: true;
  created_new: boolean;
  role: PartnerInviteRole;
  team_id?: string;
  company_id?: string;
  message: string;
}

export function useAcceptPartnerInvite() {
  return useMutation({
    mutationFn: async (args: AcceptInviteArgs): Promise<AcceptInviteResult> => {
      const { data, error } = await supabase.functions.invoke('partners-invite-accept', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as AcceptInviteResult;
    },
  });
}

// Owner view — list invites for their team/company so they can see who's
// still pending and re-send. RLS limits results to invites the caller can see.
export interface PartnerInviteRow {
  id: string;
  team_id: string | null;
  company_id: string | null;
  role: PartnerInviteRole;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  // Mirrors the partner_invite_status enum. 'declined' (migration 0023) is the
  // invitee saying no, distinct from 'cancelled' (the sender pulling it back).
  status: 'pending' | 'sent' | 'accepted' | 'expired' | 'cancelled' | 'declined';
  last_channel: 'sms' | 'email' | 'both' | null;
  expires_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

export function useTeamInvites(teamId: string | undefined) {
  return useQuery({
    queryKey: ['team-invites', teamId],
    enabled: !!teamId && supabaseConfigured,
    queryFn: async (): Promise<PartnerInviteRow[]> => {
      const { data, error } = await supabase
        .from('partner_invites')
        .select('*')
        .eq('team_id', teamId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PartnerInviteRow[];
    },
  });
}

// ─── Invitee-side: pending invites matching me ─────────────────────────────
//
// Used by InviteAcceptHost (mounted on the mover + company surfaces) to pop
// the accept/decline modal when a signed-in driver lands on the app with a
// pending invite. Matching is done by email/phone equality against the
// signed-in user's profile — RLS already enforces this via partner_invites_read.

export interface PendingInviteForMe {
  id: string;
  team_id: string | null;
  company_id: string | null;
  role: 'driver' | 'mover' | 'dispatcher';
  full_name: string | null;
  email: string | null;
  phone: string | null;
  team_name?: string | null;
  company_name?: string | null;
  expires_at: string;
  created_at: string;
}

export function useMyPendingInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-pending-invites', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    refetchInterval: 30_000,
    queryFn: async (): Promise<PendingInviteForMe[]> => {
      // Pull the user's contact bits so we can filter precisely.
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, phone')
        .eq('id', user!.id)
        .single();
      const email = (profile?.email ?? '').toLowerCase();
      const phone = profile?.phone ?? '';

      // OR on email|phone — RLS only returns rows we can see, so this is
      // also our security filter.
      const conditions: string[] = [];
      if (email) conditions.push(`email.eq.${email}`);
      if (phone) conditions.push(`phone.eq.${phone}`);
      if (conditions.length === 0) return [];

      const { data, error } = await supabase
        .from('partner_invites')
        .select(
          'id, team_id, company_id, role, full_name, email, phone, expires_at, created_at, ' +
            'partner_teams:partner_teams(display_name), companies:companies(display_name)',
        )
        .or(conditions.join(','))
        .in('status', ['pending', 'sent'])
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;

      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        team_id: r.team_id,
        company_id: r.company_id,
        role: r.role,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        team_name: r.partner_teams?.display_name ?? null,
        company_name: r.companies?.display_name ?? null,
        expires_at: r.expires_at,
        created_at: r.created_at,
      }));
    },
  });
}

/** Accept or decline a single invite via the partners-invite-respond fn. */
export function useRespondToInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { invite_id: string; decision: 'accept' | 'decline' }) => {
      const { data, error } = await supabase.functions.invoke('partners-invite-respond', {
        body: args,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        ok: true;
        status: 'accepted' | 'declined';
        team_id?: string;
        company_id?: string;
        already_resolved?: boolean;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-pending-invites'] });
      qc.invalidateQueries({ queryKey: ['my-membership'] });
    },
  });
}

export function useCompanyInvites(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-invites', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async (): Promise<PartnerInviteRow[]> => {
      const { data, error } = await supabase
        .from('partner_invites')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PartnerInviteRow[];
    },
  });
}
