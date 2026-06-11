// =============================================================================
// Sentry init + capture — call once from app/_layout.tsx
//
// Lazy-loaded via the optionalRequire helper so the dependency is OPTIONAL.
// The app runs fine without @sentry/react-native installed (errors fall back
// to console.error in ErrorBoundary). Once you opt in:
//
//   1. npx expo install @sentry/react-native
//   2. Add to .env.local:
//        EXPO_PUBLIC_SENTRY_DSN=https://YOUR_KEY@oXXX.ingest.us.sentry.io/YYY
//   3. (Optional) EXPO_PUBLIC_SENTRY_ENV=production / staging / development
//
// You'll start seeing every uncaught render error + manual captureException
// calls in your Sentry dashboard within ~30 seconds.
//
// Metro note: we used to call `import('@sentry/react-native')` directly.
// That blew up at bundle time when the SDK wasn't installed because Metro
// statically analyses every literal-string import / require. Routing
// through optionalRequire fixes that — Metro can't see the package name,
// so it skips resolution and the import becomes truly optional.
// =============================================================================

import { optionalRequire } from './optionalRequire';

let initialized = false;
let SentryRef: any = null;

function loadSentry(): any | null {
  if (SentryRef) return SentryRef;
  SentryRef = optionalRequire('@sentry/react-native');
  return SentryRef;
}

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    if (__DEV__) {
      console.log('[sentry] no DSN set — error tracking disabled (set EXPO_PUBLIC_SENTRY_DSN to enable)');
    }
    return;
  }

  const Sentry = loadSentry();
  if (!Sentry?.init) {
    if (__DEV__) {
      console.warn(
        '[sentry] @sentry/react-native is not installed. Run: npx expo install @sentry/react-native',
      );
    }
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? 'development' : 'production'),
      // Keep traces sampling low until you know your volume — bumps quickly
      // get expensive once you hit production scale.
      tracesSampleRate: __DEV__ ? 1.0 : 0.1,
      enableAutoSessionTracking: true,
      // Don't drown the dashboard in noise during dev.
      enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_DEV === '1',
    });
    if (__DEV__) console.log('[sentry] initialised');
  } catch (e) {
    console.warn('[sentry] init failed', e);
  }
}

/**
 * Report a caught error to Sentry. No-ops when the SDK isn't installed or
 * isn't initialised — safe to call from anywhere, including ErrorBoundary.
 */
export function captureException(error: unknown, context?: Record<string, any>): void {
  const Sentry = loadSentry();
  if (!Sentry?.captureException) return;
  try {
    Sentry.captureException(error, context);
  } catch {
    // ignore — never let telemetry break the host code path
  }
}
