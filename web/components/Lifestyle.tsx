// =============================================================================
// Lifestyle band — single full-bleed lifestyle image (woman with Movvy
// boxes, looking at phone) paired with a big quote-style statement.
//
// Job of this section: humanize the brand right before the partner pitch.
// The visitor has just seen "real screenshots, real features" — now we
// remind them there's a real person on the other end.
// =============================================================================

import Image from 'next/image';

export function Lifestyle() {
  return (
    <section className="relative overflow-hidden bg-ink-900">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        {/* Image side */}
        <div className="relative h-[440px] md:h-[640px]">
          <Image
            src="/marketing/lifestyle-customer.jpg"
            alt="A young woman sitting cross-legged on a hardwood floor in a sun-filled condo, smiling at her phone with two Movvy-branded moving boxes beside her and a city skyline through the window."
            fill
            className="object-cover"
            sizes="(min-width: 768px) 55vw, 100vw"
          />
          {/* Subtle gradient on the right edge so the photo melts into the
              dark text panel on desktop. */}
          <div
            aria-hidden
            className="hidden md:absolute md:inset-y-0 md:right-0 md:block md:w-32 md:bg-gradient-to-r md:from-transparent md:to-ink-900"
          />
        </div>

        {/* Copy side */}
        <div className="flex items-center px-6 py-16 md:px-12 md:py-24">
          <div className="max-w-md">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-400">
              Moving Day, Reimagined
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl md:text-[44px]">
              The day you dreaded is the easiest part of the move.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-white/70">
              Branded boxes drop-shipped to your door. A vetted crew that shows
              up on time, in uniform, with the right truck. Live tracking so
              your evening doesn&apos;t hinge on a guess. That&apos;s Movvy.
            </p>

            <div className="mt-8 inline-flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-2xl font-bold text-white">4.9★</p>
                <p className="text-[11px] uppercase tracking-wider text-white/60">
                  Average rating
                </p>
              </div>
              <div className="hidden h-10 w-px bg-white/15 sm:block" />
              <div>
                <p className="text-2xl font-bold text-white">2,400+</p>
                <p className="text-[11px] uppercase tracking-wider text-white/60">
                  Alberta moves booked
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
