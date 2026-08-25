// =============================================================================
// Open Graph image — what shows up when someone shares movvy.ca anywhere
// (iMessage, WhatsApp, Slack, Discord, LinkedIn, Facebook, Twitter/X).
// 1200×630 is the canonical OG dimension every major platform expects.
//
// Refreshed brand: charcoal card, the "mo(vv)y" wordmark, one green. Generated
// at build time by next/og (Satori) — Tailwind doesn't apply here, styles are
// inline, and only a flexbox/typography subset of CSS is supported. Text is
// split into spans (not SVG <text>, which Satori can't render).
// =============================================================================

import { ImageResponse } from 'next/og';

// No `runtime = 'edge'` on purpose — Next 14+ renders next/og on Node, and as
// of Next 16 declaring edge blocks static generation. We want this PNG baked at
// build time and cached on the CDN forever, not regenerated per request.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GREEN = '#0FA353';

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '68px 72px',
          background: '#282B2A',
          color: '#FFFFFF',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Faint truck, bottom-right */}
        <div style={{ position: 'absolute', right: 40, bottom: 24, display: 'flex', opacity: 0.08 }}>
          <svg viewBox="0 0 120 120" width="440" height="440">
            <rect x="30" y="40" width="44" height="30" rx="5" fill={GREEN} />
            <rect x="74" y="48" width="22" height="22" rx="4" fill={GREEN} />
            <circle cx="46" cy="72" r="7" fill={GREEN} />
            <circle cx="82" cy="72" r="7" fill={GREEN} />
          </svg>
        </div>

        {/* Wordmark lockup */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 14 }}>
            <div style={{ width: 26, height: 11, borderRadius: 6, background: GREEN }} />
            <div style={{ width: 42, height: 11, borderRadius: 6, background: GREEN }} />
            <div style={{ width: 58, height: 11, borderRadius: 6, background: GREEN }} />
          </div>
          <div style={{ display: 'flex', fontSize: 104, fontWeight: 900, letterSpacing: '-0.03em' }}>
            <span>mo</span>
            <span style={{ color: GREEN }}>vv</span>
            <span>y</span>
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 82,
            fontWeight: 800,
            lineHeight: 1.04,
            letterSpacing: '-0.03em',
          }}
        >
          <div>Your Move,</div>
          <div>Booked in 60 Seconds.</div>
        </div>

        {/* Bottom row — pill + supporting line + domain */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 26 }}>
            <span
              style={{
                border: `2px solid ${GREEN}`,
                borderRadius: 999,
                padding: '9px 22px',
                fontWeight: 700,
              }}
            >
              Alberta wide
            </span>
            <span style={{ color: 'rgba(250,250,248,0.6)' }}>
              No deposits · honest hourly · live tracking
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 32 }}>movvy.ca</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
