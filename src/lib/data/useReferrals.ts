import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';

// =============================================================================
// Referral codes — client-generated, server-persisted
//
// Every customer should see a unique code in the Invite Friends screen the
// very first time they open it. To make that bulletproof regardless of which
// DB migrations have been pushed, we generate the code on the client when
// the profile row is missing one and persist it via a plain UPDATE — no
// dependency on the gen_referral_code() / ensure_my_referral_code() RPCs.
//
// The generator matches the server's format ("MOV" + 4 base32 chars from a
// no-ambiguity alphabet — I/O/0/1 omitted so a customer reading it over the
// phone can't transcribe wrong) so codes look identical whether they were
// minted server-side at signup or client-side later.
// =============================================================================

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, ambiguous removed

function generateReferralCode(): string {
  let code = 'MOV';
  for (let i = 0; i < 4; i++) {
    code += REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)];
  }
  return code;
}

/**
 * Try to claim a freshly-generated code on the user's profile row. The
 * `referral_code` column has a UNIQUE constraint — on the rare collision
 * we just generate a new one and retry up to 5 times.
 *
 * IDEMPOTENCY: the UPDATE is filtered by `referral_code IS NULL`, which
 * makes it impossible to overwrite an existing code. Two tabs / devices
 * racing to mint a code for the same user will see exactly one winner —
 * the loser's UPDATE matches zero rows, we re-read the row, and return
 * whichever code was actually persisted. From the customer's perspective
 * the code never changes once it's been minted.
 */
async function persistGeneratedCode(userId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { error, count } = await supabase
      .from('profiles')
      .update({ referral_code: code }, { count: 'exact' })
      .eq('id', userId)
      .is('referral_code', null);

    if (!error && (count ?? 0) === 1) return code;

    // Another writer beat us to it OR the row already had a code.
    // Either way, re-read and return whatever is actually persisted.
    if (!error || (error as any).code === '23505') {
      const { data } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', userId)
        .maybeSingle();
      if (data?.referral_code) return data.referral_code;
      // 23505 against a different profile that holds OUR generated code —
      // generate a new one and try again on the next loop iteration.
      continue;
    }

    // Anything else (column missing, RLS, network) is not recoverable.
    throw error;
  }
  return null;
}

export interface ReferralRow {
  id: string;
  referrer_profile_id: string;
  referred_profile_id: string;
  referral_code_used: string;
  credit_cents: number;
  status: 'pending' | 'applied' | 'revoked';
  created_at: string;
}

export function useMyReferralCode() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['referral-code', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<string | null> => {
      if (!user) return null;

      // Fast path: every signup since migration 0015 gets a code via the
      // before-insert trigger on profiles. Read it directly.
      const { data, error } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', user.id)
        .maybeSingle();

      // If the column doesn't exist (migration 0015 not pushed), surface
      // null cleanly so the UI can show the empty state instead of crashing.
      if (error && (error as any).code !== 'PGRST116') {
        // PGRST116 = no row; that's fine, we'll mint one below.
        // Anything else (e.g. column-doesn't-exist) we treat as "code unavailable".
        if (__DEV__) console.warn('[referral-code] read failed', error);
        return null;
      }
      if (data?.referral_code) return data.referral_code;

      // No code on file → generate locally and persist. Works without any
      // RPC being installed, only the referral_code column from 0015.
      try {
        const minted = await persistGeneratedCode(user.id);
        if (minted) {
          // Keep the profile cache fresh too so other consumers see the new code.
          qc.invalidateQueries({ queryKey: ['profile', user.id] });
        }
        return minted;
      } catch (e) {
        if (__DEV__) console.warn('[referral-code] persist failed', e);
        return null;
      }
    },
  });
}

/** Referrals where the signed-in user is the referrer (they invited friends). */
export function useMyReferralStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['referral-stats', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [sent, received] = await Promise.all([
        supabase
          .from('referrals')
          .select('id, status, credit_cents, created_at')
          .eq('referrer_profile_id', user!.id),
        // Whether the caller has themselves used someone's code. Drives the
        // "Got a code from someone?" card — a code can only be applied once
        // per account, so once there's a row the field has nothing left to do.
        supabase
          .from('referrals')
          .select('referral_code_used, status')
          .eq('referred_profile_id', user!.id)
          .maybeSingle(),
      ]);
      const all = sent.data ?? [];
      return {
        invited: all.length,
        applied: all.filter((r) => r.status === 'applied').length,
        creditsEarnedCents: all
          .filter((r) => r.status === 'applied')
          .reduce((s, r) => s + (r.credit_cents ?? 0), 0),
        referred_by: received.data?.referral_code_used ?? null,
      };
    },
  });
}

/** One line of the credit ledger. */
export interface CreditEntry {
  id: string;
  amount_cents: number;
  kind: 'referral_referrer' | 'referral_referred' | 'adjustment' | 'redemption';
  note: string | null;
  created_at: string;
}

export interface CreditBalance {
  balance_cents: number;
  earned_cents: number;
  spent_cents: number;
  entry_count: number;
}

/**
 * The signed-in user's credit balance, from the ledger (0110).
 *
 * Deliberately NOT derived from `referrals.credit_cents` the way
 * useMyReferralStats does it. That column is what a referral is WORTH; the
 * ledger is what was actually PAID, and only the ledger knows about manual
 * adjustments or (later) redemptions. Showing someone a balance computed from
 * the wrong table is how a number in an app stops matching the money behind it.
 */
export function useMyCreditBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['credit-balance', user?.id],
    enabled: !!user && supabaseConfigured,
    queryFn: async (): Promise<CreditBalance> => {
      const { data, error } = await supabase.rpc('my_credit_balance');
      if (error) throw error;
      return {
        balance_cents: 0, earned_cents: 0, spent_cents: 0, entry_count: 0,
        ...((data ?? {}) as Partial<CreditBalance>),
      };
    },
  });
}

/** The individual credit lines, newest first — so "where did this come from?"
 *  has an answer inside the app rather than through support. */
export function useMyCreditHistory(limit = 25) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['credit-history', user?.id, limit],
    enabled: !!user && supabaseConfigured,
    queryFn: async (): Promise<CreditEntry[]> => {
      const { data, error } = await supabase
        .from('account_credits')
        .select('id, amount_cents, kind, note, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as CreditEntry[];
    },
  });
}

/**
 * Apply someone else's referral code to the signed-in account.
 *
 * This used to resolve the referrer with a direct `profiles` select filtered by
 * referral_code. RLS on profiles only ever returns the CALLER's own row, so
 * that lookup found nothing for every code but your own — every valid code came
 * back "Invalid referral code", and your own came back "You can't refer
 * yourself". Nobody could ever enter a referral, which is why `referrals` and
 * `account_credits` were empty in production.
 *
 * apply_referral_code (migration 0113) does the lookup with definer rights and
 * returns a verdict, so each outcome gets an honest sentence instead of one
 * catch-all error. It deliberately returns nothing about the referrer but
 * whether the code is real.
 *
 * The amount isn't decided here. 0110 stamps `kind` and `credit_cents` when the
 * reward is AWARDED, from what the invitee actually did — join as a customer,
 * end up completing moves, and you earn the crew reward.
 */
export function useApplyReferralCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('apply_referral_code', {
        p_code: code.trim().toUpperCase(),
      });
      if (error) throw new Error(error.message);
      const res = (data ?? {}) as { ok?: boolean; status?: string };
      if (res.ok) return { ok: true as const };
      throw new Error(APPLY_MESSAGES[res.status ?? ''] ?? "That code couldn't be applied.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referral-stats'] });
      qc.invalidateQueries({ queryKey: ['credit-balance'] });
    },
  });
}

/** One sentence per verdict the RPC can return — see migration 0113. */
const APPLY_MESSAGES: Record<string, string> = {
  unknown_code: "That code doesn't match anyone. Check the spelling and try again.",
  self: "That's your own code — share it with someone else.",
  already: "You've already used a referral code on this account.",
  too_late:
    'Referral codes have to be entered before your first paid move. Message support if you think that\'s wrong.',
  unauthenticated: 'Sign in first.',
};

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (args: { reason?: string; confirm_email_or_phone: string }) => {
      const { data, error } = await supabase.functions.invoke('account-delete', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
}
