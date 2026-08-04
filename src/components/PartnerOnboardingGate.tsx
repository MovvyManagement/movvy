// =============================================================================
// PartnerOnboardingGate — no org, no partner app.
//
// Signing in on the partner side proves you registered as a partner. It does
// NOT prove you finished onboarding: uploading your licence, your government
// ID, your truck's registration and its insurance, and picking your HQ city.
// Someone who quits halfway (or deep-links past the redirect) would otherwise
// be sitting inside the partner app having uploaded nothing.
//
// So every partner surface is pinned to onboarding until an org exists —
// create_operator_org() runs at the END of onboarding, which makes "has an org"
// the honest signal that the steps were actually completed.
//
// Accepting work is gated separately and more strictly: an admin has to APPROVE
// the truck registration (org_can_take_booking, migration 0084). This gate is
// only about reaching the app at all.
// =============================================================================

import { useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { useMyMembership } from '@/lib/data';
import { supabaseConfigured } from '@/lib/supabase';

export function PartnerOnboardingGate() {
  const { data: membership, isLoading } = useMyMembership();
  const pathname = usePathname();

  useEffect(() => {
    if (!supabaseConfigured || isLoading) return;
    // Undefined means the query hasn't resolved — don't bounce on a guess.
    if (membership === undefined) return;
    // Already where they need to be.
    if (pathname?.includes('/onboarding')) return;
    // pending-approval is its own waiting room; leave it alone.
    if (pathname?.includes('pending-approval')) return;

    const hasOrg = membership?.kind === 'company' && !!membership.company_id;
    if (!hasOrg) {
      router.replace('/(company)/onboarding/operator' as any);
    }
  }, [membership, isLoading, pathname]);

  return null;
}
