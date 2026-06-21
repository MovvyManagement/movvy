// =============================================================================
// Apple touch icon — what iOS shows when someone "Add to Home Screen"s your
// site from Safari. Next.js's app/apple-icon.tsx convention renders this PNG
// at build time using next/og's React-to-image pipeline.
// =============================================================================

import { ImageResponse } from 'next/og';

// Node.js runtime — see opengraph-image.tsx for the why.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: '#0E9F6E',
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 100 100" width="160" height="160">
          <line x1="5" y1="52" x2="14" y2="52" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="7" y1="58" x2="16" y2="58" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="9" y1="64" x2="18" y2="64" stroke="white" strokeOpacity="0.45" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="20" y="40" width="38" height="35" rx="3.5" fill="white" />
          <line x1="39" y1="40" x2="39" y2="75" stroke="#D1FAE5" strokeWidth="1.5" />
          {/* Inline "Movvy" wordmark — at 180×180 the text was barely
              legible anyway, and Node-runtime Satori doesn't render
              <text> nodes. iOS "Add to Home Screen" shows the app name
              under the icon, so the brand is never missing. */}
          <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="white" />
          <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0" />
          <circle cx="78" cy="64" r="1.6" fill="#FBBF24" />
          <circle cx="32" cy="78" r="6.2" fill="#1F2937" />
          <circle cx="32" cy="78" r="2.6" fill="#9CA3AF" />
          <circle cx="70" cy="78" r="6.2" fill="#1F2937" />
          <circle cx="70" cy="78" r="2.6" fill="#9CA3AF" />
          <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0" />
          <circle cx="76" cy="22" r="10" fill="white" />
          <path d="M76 32 L72 38 L80 38 Z" fill="white" />
          <circle cx="76" cy="22" r="4.2" fill="#0E9F6E" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
