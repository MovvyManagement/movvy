// =============================================================================
// First-paint splash for movvy.ca.
//
// Server-rendered so it paints with the very first HTML (no JS dependency), and
// it hides itself entirely through CSS (see #mv-splash in globals.css) — the
// node is never removed from the DOM, so React has nothing to reconcile and
// there's no hydration mismatch. aria-hidden keeps it out of the a11y tree so
// screen readers don't announce the wordmark twice.
// =============================================================================

export function Splash() {
  return (
    <div id="mv-splash" aria-hidden="true">
      <div className="mv-lockup">
        <div className="mv-strips">
          <span />
          <span />
          <span />
        </div>
        <div className="mv-word">
          mo<i>vv</i>y
        </div>
      </div>
      <div className="mv-tag">Your move, booked in 60 seconds</div>
      <div className="mv-bar">
        <i />
      </div>
      <div className="mv-foot">ALBERTA WIDE</div>
    </div>
  );
}
