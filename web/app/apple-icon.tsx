// =============================================================================
// Apple touch icon — what iOS shows when someone "Add to Home Screen"s your
// site from Safari. Next.js's app/apple-icon.tsx convention renders this PNG
// at build time using next/og's React-to-image pipeline (Satori).
//
// Refreshed brand: charcoal tile + the green truck. No cargo wordmark — Satori
// doesn't render SVG <text>, and at icon sizes it'd be illegible anyway; iOS
// shows the app name under the icon regardless.
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
          background: '#282B2A',
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 120 120" width="150" height="150">
          {/* speed strips */}
          <rect x="14" y="49" width="9" height="5" rx="2.5" fill="#0FA353" />
          <rect x="9" y="56" width="13" height="5" rx="2.5" fill="#0FA353" />
          <rect x="5" y="63" width="17" height="5" rx="2.5" fill="#0FA353" />
          {/* cargo + cab */}
          <rect x="30" y="40" width="44" height="30" rx="5" fill="#0FA353" />
          <rect x="30" y="63" width="44" height="7" rx="3" fill="#0A7A3E" />
          <rect x="74" y="48" width="22" height="22" rx="4" fill="#0FA353" />
          <rect x="74" y="64" width="22" height="6" rx="3" fill="#0A7A3E" />
          <rect x="78" y="51" width="11" height="9" rx="2" fill="#282B2A" />
          {/* wheels */}
          <circle cx="46" cy="72" r="7" fill="#FFFFFF" />
          <circle cx="82" cy="72" r="7" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
