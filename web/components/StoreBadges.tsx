// =============================================================================
// App Store + Play Store badges — the primary CTA on the landing page.
//
// Real badge SVGs ship from Apple + Google; what's here is a brand-aligned
// placeholder until the production graphics drop in. Click handlers point
// to the actual store URLs so the button is wired even pre-asset.
// =============================================================================

import Link from 'next/link';

// Stub URLs — replace TODO with the real App Store / Play Store URLs once
// the app is approved. Bundle ID is com.movvy.app on both platforms.
const IOS_URL = 'https://apps.apple.com/ca/app/movvy/idTODO';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.movvy.app';

interface BadgeProps {
  align?: 'start' | 'center';
  size?: 'md' | 'lg';
}

export function StoreBadges({ align = 'start', size = 'md' }: BadgeProps) {
  const cls = size === 'lg' ? 'h-14 px-6 text-base' : 'h-12 px-5 text-sm';
  return (
    <div
      className={`flex flex-wrap gap-3 ${
        align === 'center' ? 'justify-center' : 'justify-start'
      }`}
    >
      <Link
        href={IOS_URL}
        className={`group inline-flex items-center gap-3 rounded-2xl bg-ink-900 ${cls} font-bold text-white transition hover:bg-ink-800`}
      >
        <AppleIcon />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-medium opacity-80">Download on the</span>
          <span>App Store</span>
        </span>
      </Link>
      <Link
        href={ANDROID_URL}
        className={`group inline-flex items-center gap-3 rounded-2xl bg-ink-900 ${cls} font-bold text-white transition hover:bg-ink-800`}
      >
        <PlayIcon />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-medium opacity-80">Get it on</span>
          <span>Google Play</span>
        </span>
      </Link>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.86 1.04-2.27 1.84-3.482 1.74-.14-1.11.444-2.27 1.144-3.08.847-.98 2.328-1.74 3.515-1.74zM20.5 17.61c-.55 1.21-.81 1.76-1.51 2.83-.99 1.51-2.39 3.39-4.12 3.4-1.54.01-1.94-1.01-4.03-1-2.09.01-2.53 1.01-4.07 1-1.73-.01-3.06-1.71-4.05-3.22-2.77-4.22-3.06-9.18-1.35-11.82 1.21-1.87 3.13-2.97 4.93-2.97 1.84 0 3 .99 4.52.99 1.47 0 2.37-.99 4.5-.99 1.61 0 3.31.88 4.52 2.39-3.98 2.18-3.33 7.85.66 9.39z"/>
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 2.5v19c0 .67.37 1.25.93 1.55l11.36-11.05L3.93.95C3.37 1.25 3 1.83 3 2.5zm14.93 9.51l3.04-1.76c.69-.4.69-1.4 0-1.8L18 6.8 14.51 12l3.42 0zM4.74 22.3l11.7-11.39 1.95 1.13c.69.4.69 1.4 0 1.8L5.74 22.5l-1-.2z"/>
    </svg>
  );
}
