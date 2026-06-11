// Twitter card image — same 1200x630 design as the OG image. Twitter
// requires its own file alongside opengraph-image so we share the visual
// via an internal helper rather than re-exporting (Next disallows
// re-exporting route segment configs).

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background:
            'linear-gradient(135deg, #047857 0%, #0E9F6E 50%, #16A34A 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 18,
              background: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 100 100" width="72" height="72">
              <rect width="100" height="100" rx="22" fill="#0E9F6E" />
              <rect x="20" y="40" width="38" height="35" rx="3.5" fill="white" />
              <line x1="39" y1="40" x2="39" y2="75" stroke="#D1FAE5" strokeWidth="1.5" />
              <text x="39.5" y="62" textAnchor="middle" fill="#047857" fontWeight="800" fontSize="9.5" fontFamily="sans-serif">
                Movvy
              </text>
              <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="white" />
              <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0" />
              <circle cx="32" cy="78" r="6.2" fill="#1F2937" />
              <circle cx="70" cy="78" r="6.2" fill="#1F2937" />
              <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0" />
              <circle cx="76" cy="22" r="10" fill="white" />
              <path d="M76 32 L72 38 L80 38 Z" fill="white" />
              <circle cx="76" cy="22" r="4.2" fill="#0E9F6E" />
            </svg>
          </div>
          <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.02em' }}>Movvy</div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 96,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
          }}
        >
          <div>Your Move,</div>
          <div>Booked in 60 Seconds.</div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 28,
            opacity: 0.95,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span>★ 4.9</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>$2M insured</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>Vetted Alberta crews</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 32 }}>movvy.ca</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
