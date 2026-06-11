// =============================================================================
// Movvy brand mark.
//
// Two surfaces:
//   • <Logo />     — the small mark for Nav + Footer (rounded square, ~28px)
//   • <AppIcon />  — the same mark scaled up for the hero phone mockup,
//                    presented as the App Store icon.
//
// SVG embedded so the logo renders zero-flash, with no extra HTTP request.
// If you'd rather use the high-res PNG of the truck+pin icon, drop it at
// /public/logo.png and swap the SVG body for <img src="/logo.png" />.
// =============================================================================

interface Props {
  size?: number;
}

export function Logo({ size = 28 }: Props) {
  return <MovvyMark size={size} aria-label="Movvy" />;
}

export function AppIcon({ size = 64 }: Props) {
  return <MovvyMark size={size} aria-label="Movvy app icon" />;
}

function MovvyMark({ size, ...rest }: { size: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      {/* Rounded green tile — App Store icon shape */}
      <rect width="100" height="100" rx="22" fill="#0E9F6E" />

      {/* Motion lines on the far left — sense of "in transit" */}
      <line x1="5" y1="52" x2="14" y2="52" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="7" y1="58" x2="16" y2="58" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="9" y1="64" x2="18" y2="64" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />

      {/* Cargo box */}
      <rect x="20" y="40" width="38" height="35" rx="3.5" fill="white" />
      {/* Box panel divider line (matches the original artwork) */}
      <line x1="39" y1="40" x2="39" y2="75" stroke="#D1FAE5" strokeWidth="1.5" />

      {/* Wordmark */}
      <text
        x="39.5"
        y="62"
        textAnchor="middle"
        fill="#047857"
        fontWeight="800"
        fontSize="9.5"
        fontFamily="Inter, system-ui, sans-serif"
        letterSpacing="-0.3"
      >
        Movvy
      </text>

      {/* Cab (driver compartment + windshield) */}
      <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="white" />
      <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0" />
      <circle cx="78" cy="64" r="1.6" fill="#FBBF24" />

      {/* Wheels — outer tire + inner hub */}
      <circle cx="32" cy="78" r="6.2" fill="#1F2937" />
      <circle cx="32" cy="78" r="2.6" fill="#9CA3AF" />
      <circle cx="70" cy="78" r="6.2" fill="#1F2937" />
      <circle cx="70" cy="78" r="2.6" fill="#9CA3AF" />

      {/* Bumper / ground accent */}
      <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0" />

      {/* Location pin — top right */}
      <circle cx="76" cy="22" r="10" fill="white" />
      <path d="M76 32 L72 38 L80 38 Z" fill="white" />
      <circle cx="76" cy="22" r="4.2" fill="#0E9F6E" />
    </svg>
  );
}
