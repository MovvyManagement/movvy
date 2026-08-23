// =============================================================================
// Brand-level constants surfaced to the UI.
//
// Single source-of-truth for the figures that appear on the welcome screen,
// booking confirmation, trust strip, and marketing-style copy. Update once
// here and every screen reflects the change.
// =============================================================================

/** Lifetime move count displayed in the social-proof line on welcome. */
export const TOTAL_MOVES_TAGLINE = '500+';

/** Average customer rating shown alongside the move count. */
export const AVG_RATING_TAGLINE = '4.9';

/** Insurance coverage cap shown to customers + on booking confirm.
 *  Dollar value covered per move under Movvy's policy (or partner's where
 *  applicable). Keep a single string so we never have $5,000 in one place
 *  and $5000 in another. */
export const COVERAGE_AMOUNT = '$5,000';
export const COVERAGE_LABEL = `Up to ${COVERAGE_AMOUNT} in coverage included`;
export const COVERAGE_SHORT = `${COVERAGE_AMOUNT} coverage`;

/** Movvy commission rate as a fraction of the booking total. Single source
 *  of truth for every partner-payout estimate across the driver/company UI —
 *  job cards, the driver dashboard, and the job-detail screen all derive their
 *  "you'll earn $X" figure from this so the number can never drift between
 *  screens. The authoritative post-move payout is still driver_payouts.net_cents;
 *  this rate only powers the pre-acceptance ESTIMATE. */
export const PARTNER_COMMISSION_RATE = 0.20;
/** Partner's keep rate — the complement of the commission. */
export const PARTNER_SHARE_RATE = 1 - PARTNER_COMMISSION_RATE; // 0.80

/** Movvy commission rate as displayed to partners.
 *
 *  DERIVED, not typed out. The literal version of this drifted: three screens
 *  said "17%" long after the rate became 20%, so a crew read one number on
 *  their Earnings tab and was paid by another. Percentages in copy belong to
 *  the constant that decides the money, or they eventually disagree with it. */
export const COMMISSION_PCT = Math.round(PARTNER_COMMISSION_RATE * 100);
export const PARTNER_SHARE_PCT = Math.round(PARTNER_SHARE_RATE * 100);
export const COMMISSION_RATE_LABEL = `Movvy keeps ${COMMISSION_PCT}% · you keep ${PARTNER_SHARE_PCT}%`;

// =============================================================================
// LEGAL / TERMS
// =============================================================================
//
// Bump these together every time the Terms text in `app/(legal)/terms.tsx`
// changes substantively. The version string is written to
// `profiles.terms_accepted_version` at signup so we can detect users who
// accepted an older revision and re-prompt them per Section 14 of the Terms.
//
// Format: YYYY-MM-DD of the effective date. Keeping the version string
// equal to the effective date means no separate counter to keep in sync.

/** Effective date displayed at the top of the Terms screen + on signup. */
export const TERMS_EFFECTIVE_DATE = 'June 2, 2026';
/** Machine-comparable version — same date in ISO form. */
export const TERMS_VERSION = '2026-06-02';

/** Effective date for the privacy policy companion doc. Same cadence as
 *  the Terms; bump when the policy text changes. */
export const PRIVACY_EFFECTIVE_DATE = 'June 2, 2026';
export const PRIVACY_VERSION = '2026-06-02';
