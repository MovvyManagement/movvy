// =============================================================================
// Analytics — thin PostHog wrapper
//
// Why this exists:
//   • Funnel data is the #1 input for "what should we fix next?"
//   • Untyped track() calls scattered across screens decay fast — we keep
//     event names + payload shapes here so renames are one file.
//
// In production, set EXPO_PUBLIC_POSTHOG_KEY + (optional) EXPO_PUBLIC_POSTHOG_HOST.
// When the key is missing, every call no-ops + logs to console so we can
// see the event stream in dev without sending anything.
//
// Integration plan:
//   1. install posthog-react-native: npm install posthog-react-native
//   2. wrap _layout.tsx with the PostHogProvider once a key is configured
//   3. call track('event', { ... }) from anywhere in the app
// =============================================================================

import { optionalRequire } from './optionalRequire';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';

/** Funnel event names — keep this list flat so we have one source of truth. */
export type AnalyticsEvent =
  | 'app_open'
  | 'signup_started'
  | 'signup_completed'
  | 'login_completed'
  | 'partner_signin_completed'
  | 'partner_join_completed'
  | 'booking_started'
  | 'booking_addresses_set'
  | 'booking_type_set'
  | 'booking_schedule_set'
  | 'booking_confirm_viewed'
  | 'booking_created'
  | 'booking_cancelled'
  | 'driver_online_toggled'
  | 'driver_accepted_job'
  | 'driver_completed_job'
  | 'review_submitted'
  | 'tip_submitted'
  | 'receipt_downloaded'
  | 'invite_sent'
  | 'invite_accepted';

// PostHog client reference — lazy-loaded so importing this module doesn't
// pull in the SDK if it's not configured.
let posthog: any = null;

async function ensureClient(): Promise<any | null> {
  if (!POSTHOG_KEY) return null;
  if (posthog) return posthog;
  // Loaded via optionalRequire so Metro doesn't try to resolve
  // posthog-react-native at bundle time when the package isn't installed.
  const mod = optionalRequire<any>('posthog-react-native');
  if (!mod?.PostHog) {
    if (__DEV__) {
      console.warn('[analytics] posthog-react-native not installed; events will be logged only.');
    }
    return null;
  }
  try {
    posthog = new mod.PostHog(POSTHOG_KEY, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    });
    return posthog;
  } catch (e) {
    console.warn('[analytics] PostHog init failed', e);
    return null;
  }
}

/** Fire-and-forget event tracker. Safe to call from anywhere. */
export function track(event: AnalyticsEvent, props?: Record<string, any>): void {
  // Always log in dev so we can see the funnel locally.
  if (__DEV__) {
    console.log(`[analytics] ${event}`, props ?? {});
  }
  ensureClient().then((client) => {
    if (!client) return;
    try {
      client.capture(event, props);
    } catch (e) {
      console.warn('[analytics] capture failed', e);
    }
  });
}

/** Associate the current session with a profile id (call after sign-in). */
export function identify(profileId: string, props?: Record<string, any>): void {
  if (__DEV__) console.log('[analytics] identify', profileId, props ?? {});
  ensureClient().then((client) => {
    if (!client) return;
    try {
      client.identify(profileId, props);
    } catch (e) {
      console.warn('[analytics] identify failed', e);
    }
  });
}

/** Clear the identified user (call on sign-out). */
export function resetAnalytics(): void {
  if (__DEV__) console.log('[analytics] reset');
  ensureClient().then((client) => {
    if (!client) return;
    try {
      client.reset();
    } catch {
      /* noop */
    }
  });
}
