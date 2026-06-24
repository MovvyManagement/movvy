// =============================================================================
// Hero — first impression. Now anchored by a real branded product mockup
// (phone on marble with the Movvy box) rather than a CSS phone shell.
//
// The right column is one big image with a soft glow that visually lifts it
// off the page; the left column carries the value prop + CTA. Above the
// fold on desktop, the image dominates → that's the brand statement.
// =============================================================================

import Image from 'next/image';
import { StoreBadges } from './StoreBadges';
import { TrustChips } from './TrustChips';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-brand-50/40 to-white">
      {/* Soft ambient blobs — adds depth behind the hero image without
          competing with it. Pure CSS, no extra requests. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full bg-brand-200/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-brand-100/60 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-24 pt-16 md:grid-cols-[1.05fr_1fr] md:pt-24 lg:pb-28">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
            </span>
            Now Serving All of Alberta
          </div>

          <h1 className="text-4xl font-bold leading-[1.02] tracking-tight text-ink-900 sm:text-5xl md:text-6xl lg:text-[68px]">
            Moving made{' '}
            <span className="bg-gradient-to-r from-brand-700 to-brand-500 bg-clip-text text-transparent">
              simple.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-silver-600">
            Reliable movers. Real-time tracking. Zero stress. Movvy gives you a
            vetted crew, honest hourly pricing, and live GPS from pickup to
            drop-off — booked in under 60 seconds.
          </p>

          <div className="mt-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-silver-500">
              Get the App
            </p>
            <StoreBadges size="lg" />
          </div>

          <TrustChips className="mt-8" />
        </div>

        {/* Right column — the hero photo. The slight rotation + double shadow
            gives a "lifted off the page" effect that pure flat images lose. */}
        <div className="relative flex justify-center md:justify-end">
          <div className="relative w-full max-w-[560px]">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-[36px] bg-gradient-to-br from-brand-300/40 via-brand-100/30 to-transparent blur-2xl"
            />
            <Image
              src="/marketing/hero-phone-marble.jpg"
              alt="The Movvy app open on an iPhone resting on a marble counter, beside a branded Movvy box and a small succulent."
              width={1654}
              height={977}
              priority
              className="relative w-full rounded-3xl object-cover shadow-[0_30px_80px_-20px_rgba(4,120,87,0.25)] ring-1 ring-black/5"
            />

            {/* Floating booking-confirmed chip — tells the visitor in one
                glance "this is what the app does." */}
            <div className="absolute -left-3 -bottom-5 hidden items-center gap-3 rounded-2xl border border-brand-100 bg-white/95 px-4 py-3 shadow-xl backdrop-blur sm:flex md:-left-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div className="leading-tight">
                <p className="text-[11px] font-bold uppercase tracking-wider text-silver-500">
                  Move booked
                </p>
                <p className="text-sm font-bold text-ink-900">Sat, 8–12 · Calgary</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
