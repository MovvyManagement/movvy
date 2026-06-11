// =============================================================================
// /(company)/dispatch — redirect to /(company)/jobs.
//
// Dispatch used to be its own tab with its own screen. It's been folded
// into the unified Jobs screen — the dispatcher now does new-request
// triage, driver assignment, in-progress tracking, and completed-job
// review from one place. This file stays as a redirect target so any
// stale deep links (push notifications, bookmarked URLs) land on the new
// surface instead of a "screen not found" error.
// =============================================================================

import { Redirect } from 'expo-router';

export default function DispatchRedirect() {
  return <Redirect href="/(company)/jobs" />;
}
