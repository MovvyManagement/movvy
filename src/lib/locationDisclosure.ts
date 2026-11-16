// =============================================================================
// locationDisclosure — explain background location BEFORE the OS asks for it.
//
// Google Play rejects apps that request background location without first
// showing their own in-app notice: what is collected, why, and that it keeps
// working when the app is closed or not in use. Apple expects the reason to be
// clear too. The crew app used to go straight to the system prompts when a
// move started, so this gate sits in front of those requests.
//
// How it fits together:
//   • LocationDisclosureSheet (mounted once in the crew layout) registers a
//     presenter here.
//   • startLiveLocation() calls confirmLocationDisclosure() whenever the OS is
//     about to show a location prompt. It resolves true once the crew member
//     taps Continue, false if they decline (Android) or no sheet is mounted.
//   • Nothing is remembered: the notice appears every time the OS would ask,
//     and never when permission is already settled, so it always comes right
//     before a real prompt and never on its own.
// =============================================================================

type Presenter = () => Promise<boolean>;

let presenter: Presenter | null = null;
let inFlight: Promise<boolean> | null = null;

/** Called by LocationDisclosureSheet on mount (and with null on unmount). */
export function registerLocationDisclosure(next: Presenter | null): void {
  presenter = next;
}

/**
 * Show the notice and wait for the crew member's answer. Concurrent callers
 * share one sheet. Without a mounted sheet the answer is false, so the app
 * never reaches a system prompt that wasn't explained first.
 */
export function confirmLocationDisclosure(): Promise<boolean> {
  if (!presenter) return Promise.resolve(false);
  if (!inFlight) {
    inFlight = presenter().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
