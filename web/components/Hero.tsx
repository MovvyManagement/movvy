// =============================================================================
// Hero — first impression. Optimized for download conversion, not booking.
//
// Three things above the fold:
//   1. Value prop — "Your move, booked in 60 seconds"
//   2. Trust micro-signals (rating + insurance + cities)
//   3. App Store + Play Store badges (the one and only CTA)
//
// No address inputs, no price calculator — we deliberately don't compete
// with the app. The web's job is to send qualified traffic to the stores.
// =============================================================================

import { StoreBadges } from './StoreBadges';
import { TrustChips } from './TrustChips';
import { AppIcon } from './Logo';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-brand-50 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 md:grid-cols-2 md:pt-24">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-brand-600" />
            Now Serving All of Alberta
          </div>
          <h1 className="text-4xl font-bold leading-[1.05] text-ink-900 sm:text-5xl md:text-6xl">
            Your Move,<br />
            <span className="bg-gradient-to-r from-brand-700 to-brand-500 bg-clip-text text-transparent">
              Booked in 60 Seconds.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-silver-600">
            Vetted crews. Honest hourly pricing. Live tracking from pickup to
            drop-off. Movvy makes moving day actually feel easy — no quote
            forms, no phone tag, no awkward calls to four different companies.
          </p>

          <div className="mt-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-silver-500">
              Get the App
            </p>
            <StoreBadges size="lg" />
          </div>

          <TrustChips className="mt-8" />
        </div>

        {/* Phone mockup column */}
        <div className="relative flex justify-center md:justify-end">
          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

// CSS phone shell with the real Movvy app icon on the home screen + a peek
// at the booking widget. Replace with a real screenshot once design ships.
function PhoneMock() {
  return (
    <div className="relative aspect-[9/19] w-[280px] rounded-[44px] border-[10px] border-ink-900 bg-ink-900 shadow-2xl md:w-[320px]">
      <div className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-ink-900" />
      <div className="h-full w-full overflow-hidden rounded-[32px] bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-5">
        <div className="flex h-full flex-col">
          <div className="mt-8 flex items-center gap-3">
            <AppIcon size={44} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/80">
                Hi Sarah
              </p>
              <p className="mt-0.5 text-lg font-bold text-white">Where to today?</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <FakeField label="Moving From" value="1212 17 Ave SW, Calgary" dot="bg-ink-900" />
            <FakeField label="Moving To" value="4001 Bow Trail SW, Calgary" dot="bg-brand-700" />
          </div>
          <div className="mt-auto rounded-2xl bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
              Estimated Total
            </p>
            <p className="mt-1 text-2xl font-bold text-ink-900">$648</p>
            <p className="text-[10px] text-silver-500">2-bed condo · 9-11 AM Sat</p>
            <div className="mt-3 rounded-xl bg-ink-900 py-2.5 text-center text-sm font-bold text-white">
              Book Your Crew
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FakeField({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <p className="truncate text-xs font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
