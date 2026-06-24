// =============================================================================
// "Drive with Movvy" callout — the secondary audience.
//
// Now anchored by a real photo of a Movvy crew loading at golden hour,
// with a dark gradient overlay so the text stays legible. CTA jumps to
// /partners where the full pitch lives.
// =============================================================================

import Image from 'next/image';
import Link from 'next/link';

export function ForPartners() {
  return (
    <section className="relative overflow-hidden bg-ink-900 text-white">
      {/* Background hero image — full-bleed, with a dark gradient to keep
          the copy legible at any width. */}
      <Image
        src="/marketing/crew-loading-truck.jpg"
        alt="Two Movvy crew members in dark uniforms carrying branded Movvy boxes from a Movvy box truck into a modern building lobby at golden hour."
        fill
        className="object-cover object-center opacity-50"
        sizes="100vw"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/85 to-ink-900/30"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink-900/80 via-transparent to-transparent"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 md:grid-cols-2 md:py-28">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-400">
            For Movers + Moving Companies
          </p>
          <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
            More jobs.<br />Less hassle.
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/80">
            Solo operators, 2-person crews, and full moving companies all earn
            on Movvy. We bring the customer; you do what you do best — show
            up, move smart, get paid weekly.
          </p>
          <Link
            href="/partners"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-ink-900 shadow-lg transition hover:bg-brand-50 hover:shadow-xl"
          >
            See How Partners Earn
            <span aria-hidden>→</span>
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Stat n="$0" label="Setup + monthly fees" />
          <Stat n="$0" label="Lead fees per job" />
          <Stat n="Weekly" label="Direct deposit payouts" />
          <Stat n="48 hrs" label="From sign-up to first job" />
        </div>
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
      <p className="text-3xl font-bold text-white">{n}</p>
      <p className="mt-1 text-xs leading-5 text-white/80">{label}</p>
    </div>
  );
}
