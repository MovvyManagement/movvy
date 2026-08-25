// =============================================================================
// Movvy brand marks (web).
//
// Two surfaces, matching the refreshed brand system (charcoal + one green,
// Archivo Black wordmark):
//   • <Wordmark /> — the header/footer lockup: three green speed-strips + the
//                    lowercase "mo(vv)y" wordmark, the "vv" in brand green.
//                    This is what goes on movvy.ca chrome — NOT the truck.
//   • <AppIcon />  — the charcoal app-tile with the green truck, i.e. what the
//                    App Store shows. Used in the hero phone mockup.
//
// `Logo` stays exported as an alias of Wordmark so existing imports keep working.
// SVG/inline so both render zero-flash with no extra HTTP request.
// =============================================================================

const GREEN = '#0FA353';
const GREEN_DEEP = '#0A7A3E';
const CHARCOAL = '#282B2A';
const INK = '#161615';

interface WordmarkProps {
  /** Cap height of the wordmark in px. Strips scale with it. */
  size?: number;
  /** Render the wordmark white (for placement on charcoal / dark surfaces). */
  onDark?: boolean;
}

export function Wordmark({ size = 28, onDark = false }: WordmarkProps) {
  const stripH = Math.max(2, Math.round(size * 0.16));
  const gap = Math.max(2, Math.round(size * 0.16));
  const widths = [0.37, 0.6, 0.83].map((f) => Math.round(size * f));
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'flex-end', gap: Math.round(size * 0.34) }}
      role="img"
      aria-label="Movvy"
    >
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap,
          paddingBottom: Math.round(size * 0.16),
        }}
      >
        {widths.map((w, i) => (
          <span
            key={i}
            style={{ width: w, height: stripH, borderRadius: stripH, background: GREEN }}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-archivo-black), system-ui, sans-serif',
          fontWeight: 900,
          fontSynthesis: 'none',
          fontSize: size,
          lineHeight: 0.9,
          letterSpacing: '-0.03em',
          color: onDark ? '#FFFFFF' : INK,
        }}
      >
        mo<span style={{ color: GREEN }}>vv</span>y
      </span>
    </span>
  );
}

/** Back-compat alias — Nav/Footer historically imported `Logo`. */
export const Logo = Wordmark;

/** The charcoal app-tile with the green truck — the App Store icon. */
export function AppIcon({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Movvy app icon"
    >
      <rect width="120" height="120" rx="27" fill={CHARCOAL} />
      {/* speed strips */}
      <rect x="14" y="49" width="9" height="5" rx="2.5" fill={GREEN} />
      <rect x="9" y="56" width="13" height="5" rx="2.5" fill={GREEN} />
      <rect x="5" y="63" width="17" height="5" rx="2.5" fill={GREEN} />
      {/* cargo + cab */}
      <rect x="30" y="40" width="44" height="30" rx="5" fill={GREEN} />
      <rect x="30" y="63" width="44" height="7" rx="3" fill={GREEN_DEEP} />
      <rect x="74" y="48" width="22" height="22" rx="4" fill={GREEN} />
      <rect x="74" y="64" width="22" height="6" rx="3" fill={GREEN_DEEP} />
      <rect x="78" y="51" width="11" height="9" rx="2" fill={CHARCOAL} />
      {/* wheels */}
      <circle cx="46" cy="72" r="7" fill="#FFFFFF" />
      <circle cx="82" cy="72" r="7" fill="#FFFFFF" />
    </svg>
  );
}
