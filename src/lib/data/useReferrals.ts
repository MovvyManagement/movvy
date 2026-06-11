import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

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
      const { data } = await supabase
        .from('referrals')
        .select('id, status, credit_cents, created_at')
        .eq('referrer_profile_id', user!.id);
      const all = data ?? [];
      return {
        invited: all.length,
        applied: all.filter((r) => r.status === 'applied').length,
        creditsEarnedCents: all
          .filter((r) => r.status === 'applied')
          .reduce((s, r) => s + (r.credit_cents ?? 0), 0),
      };
    },
  });
}

/** Apply a code to the signed-in user's account (during or after signup). */
export function useApplyReferralCode() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      if (!user) throw new Error('Sign in first');
      const clean = code.trim().toUpperCase();
      // Find the referrer
      const { data: referrer, error: refErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('referral_code', clean)
        .maybeSingle();
      if (refErr) throw new Error(refErr.message);
      if (!referrer) throw new Error('Invalid referral code');
      if (referrer.id === user.id) throw new Error("You can't refer yourself");

      const { error } = await supabase.from('referrals').insert({
        referrer_profile_id: referrer.id,
        referred_profile_id: user.id,
        referral_code_used: clean,
        credit_cents: 5000,
        status: 'pending',
      });
      if (error) {
        // Unique-pair violation = already applied
        if ((error as any).code === '23505') throw new Error("You've already used this referral");
        throw new Error(error.message);
      }
      return { ok: true, credit_cents: 5000 };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referral-stats'] }),
  });
}

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
