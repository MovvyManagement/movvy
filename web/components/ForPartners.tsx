// =============================================================================
// "Drive with Movvy" callout — the secondary audience.
//
// Sits between consumer-focused sections so the page stays one big funnel
// but moving-company owners still see themselves. CTA jumps to /partners
// where the full pitch lives.
// =============================================================================

import Link from 'next/link';

export function ForPartners() {
  return (
    <section className="bg-ink-900 py-20 text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-400">
            For Movers + Moving Companies
          </p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
            More Jobs.<br />Less Hassle.
          </h2>
          <p className="mt-5 max-w-md text-base text-white/70">
            Solo operators, 2-person crews, and full moving companies all earn
            on Movvy. We bring the customer; you do what you do best.
          </p>
          <Link
            href="/partners"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-ink-900 transition hover:bg-brand-50"
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-3xl font-bold text-white">{n}</p>
      <p className="mt-1 text-xs leading-5 text-white/70">{label}</p>
    </div>
  );
}
