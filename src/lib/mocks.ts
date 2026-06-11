// =============================================================================
// Mock-data guard
//
// Mock arrays (mockBookings, mockJobs, mockMessages, etc.) were originally
// used as visual fallbacks during early UI work — so screens never looked
// empty during development. In production this is dangerous: an outage or
// empty-state bug could surface mock data to a real customer ("here's your
// move… to a fake address in Calgary").
//
// One flag controls all fallbacks. In production this is hard-FALSE.
// In development, set EXPO_PUBLIC_USE_MOCK_FALLBACKS=1 to opt back in for
// design work on screens that haven't been wired to real data yet.
//
// At every fallback site, use `withMockFallback(real, mock)` so the rule
// is enforced uniformly.
// =============================================================================

const ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_USE_MOCK_FALLBACKS === '1';

/** True iff mock-data fallbacks are allowed in this environment. */
export const mockFallbacksEnabled = ENABLED;

/**
 * Return real if it has rows, otherwise fall back to mock only when mocks
 * are explicitly enabled. In production this collapses to `real ?? []`.
 */
export function withMockFallback<T>(real: T[] | null | undefined, mock: T[]): T[] {
  if (real && real.length > 0) return real;
  return ENABLED ? mock : [];
}
