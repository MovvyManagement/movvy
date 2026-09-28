// =============================================================================
// Last-portal memory
//
// Expo Router always cold-starts on `/` (the marketing welcome screen).
// Supabase restores the persisted session silently, but nothing navigates — so
// a signed-in user who fully closed and reopened the app was stranded on
// "Get started / I already have an account" and had to sign in again despite a
// valid session (see app/index.tsx).
//
// We record which portal HOME a user was routed to at sign-in and replay it on
// the next cold start when a session still exists. We deliberately store only
// the terminal homes — never onboarding/pending routes, which are transient and
// would trap a user on a waiting-room screen after their state has moved on.
// The value is cleared on logout so the next person to sign in never inherits
// the previous user's portal.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@movvy/last-portal-v1';

/** The portal homes we're willing to send a returning, signed-in user back to. */
export type PortalHome =
  | '/(customer)/(tabs)/home'
  | '/(company)/(tabs)/dashboard'
  | '/(mover)/(tabs)/dashboard';

export async function setLastPortal(route: PortalHome): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, route);
  } catch {
    // Non-fatal: worst case the next cold start falls back to customer home.
  }
}

export async function getLastPortal(): Promise<PortalHome | null> {
  try {
    return ((await AsyncStorage.getItem(KEY)) as PortalHome | null) ?? null;
  } catch {
    return null;
  }
}

export async function clearLastPortal(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Non-fatal.
  }
}
