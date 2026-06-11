import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';
import type { DbProfile } from '@/lib/supabase/types';

const PROFILE_KEY = (uid: string | undefined) => ['profile', uid] as const;

// =============================================================================
// useProfile / useUpdateProfile
//
// Defensive about a missing profile row. The standard signup path mirrors
// auth.users into public.profiles via the handle_new_user trigger (migration
// 0006), but a handful of accounts can slip through — older users created
// before the trigger existed, or a trigger run that silently failed because
// raw_user_meta_data carried an invalid role.
//
// When the read or write of the profile row returns "no row" we call the
// ensure_my_profile() RPC (migration 0030, SECURITY DEFINER) which inserts a
// minimal row pinned to role='customer', then retry.
//
// useUpdateProfile reads the row back via .select().single() on every write
// and pushes the authoritative result into the cache itself — invalidation
// alone was not always triggering a refetch when the EditNameSheet /
// EditPhoneSheet modal closed (the profile screen's `useProfile` observer
// is still active, but on some Android devices the visibility transition
// suppressed the refetch). Writing the returned row directly removes that
// dependency: the cache is correct synchronously when onSuccess fires, so
// every consumer (top of profile, home greeting, avatar, receipts) renders
// the new value on the next commit no matter what.
// =============================================================================

async function ensureProfileRow(): Promise<void> {
  try {
    await supabase.rpc('ensure_my_profile');
  } catch {
    /* best-effort — migration 0030 may not be pushed yet */
  }
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: PROFILE_KEY(user?.id),
    enabled: !!user?.id,
    queryFn: async (): Promise<DbProfile | null> => {
      if (!user) return null;
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await ensureProfileRow();
        const retry = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (retry.error) throw retry.error;
        data = retry.data;
      }
      return (data ?? null) as DbProfile | null;
    },
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Partial<DbProfile>): Promise<DbProfile> => {
      if (!user) throw new Error('Not signed in');

      // First attempt. Selecting the row back gives us the authoritative
      // post-write state — we use it to update the cache directly so
      // every consumer renders the new value on the next commit instead
      // of waiting on a refetch round-trip.
      const first = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select('*')
        .maybeSingle();
      if (first.error) throw first.error;

      if (first.data) return first.data as DbProfile;

      // No row updated — the profile is missing. Mint via the SECURITY
      // DEFINER RPC, then retry. .single() this time because after the
      // ensure call there MUST be a row, and we want a hard error if not.
      await ensureProfileRow();
      const retry = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select('*')
        .single();
      if (retry.error) {
        throw new Error(
          "Couldn't save — your account is missing a profile record. Sign out and sign back in.",
        );
      }
      return retry.data as DbProfile;
    },
    onSuccess: (updated) => {
      // Write the authoritative row into the cache synchronously so every
      // consumer that selects from PROFILE_KEY (top-of-profile name,
      // avatar initials, home greeting, receipt header) re-renders with
      // the new value the moment the sheet closes. Then invalidate for
      // good measure so any other observers (chat headers etc.) refetch.
      if (user?.id) {
        qc.setQueryData(PROFILE_KEY(user.id), updated);
      }
      qc.invalidateQueries({ queryKey: PROFILE_KEY(user?.id) });
    },
  });
}
