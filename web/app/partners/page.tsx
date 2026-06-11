// =============================================================================
// /partners — recruiting page for moving companies + 2-person crews.
//
// Mirrors the mobile app's /partner route: pick "Independent operator" or
// "Moving company" and either way the CTA is "Download the app to apply."
// We don't take applications on the web — the partner-onboarding flow lives
// in the mobile app because it needs camera access (ID, license, insurance
// uploads) and the same Supabase Auth session the rest of the app uses.
// =============================================================================

import type { Metadata } from 'next';
import { StoreBadges } from '@/components/StoreBadges';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Drive with Movvy',
  description:
    'Alberta movers — solo operators, 2-person crews, and moving companies — earn more by driving with Movvy. No fees, weekly payouts.',
};

const benefits = [
  {
    title: 'No Setup or Monthly Fee',
    body: "You don't pay to be on Movvy. We take a small per-move margin — and that's it.",
  },
  {
    title: 'Real Jobs, Pre-Screened',
    body: 'Stop chasing leads on Kijiji. Movvy sends jobs in your service area with the customer, the schedule, and the addresses already locked in.',
  },
  {
    title: 'Weekly Direct Deposit',
    body: 'Earnings update in the app the moment a job ends. Payouts hit your Canadian bank every week, with a clean breakdown for your records.',
  },
  {
    title: 'Built for Canadian Crews',
    body: 'CAD payouts. GST/HST tracking. Canadian banking. Made-in-Calgary support that actually picks up the phone.',
  },
];

export default function Partners() {
  return (
    <>
      <section className="bg-gradient-to-br from-white via-brand-50 to-white py-20">
        <div className="mx-auto max-w-4xl px-5 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            For Movers + Moving Companies
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-tight text-ink-900 sm:text-5xl">
            More Jobs. Less Hassle.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-silver-600">
            Movvy is Alberta's moving marketplace. We bring the customer; you
            keep doing what you're good at. Apply directly in the app —
            verification takes 24–48 hours.
          </p>

          <div className="mt-8 flex justify-center">
            <StoreBadges align="center" size="lg" />
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="text-center text-3xl font-bold text-ink-900 sm:text-4xl">
            Why Movvy Partners Earn More.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-3xl border border-silver-200 bg-white p-6"
              >
                <h3 className="text-lg font-bold text-ink-900">{b.title}</h3>
                <p className="mt-2 text-sm leading-6 text-silver-600">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-silver-50 py-20">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-center text-3xl font-bold text-ink-900 sm:text-4xl">
            Two Ways to Join.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Tile
              title="Independent Operator"
              body="You drive. You move. Bring a partner and run as a 2-person crew."
              bullet={['No employees needed', 'Set your own hours', 'Run jobs solo or with a partner']}
            />
            <Tile
              title="Moving Company"
              body="Add your fleet of drivers and trucks. Use Movvy as a steady job feed."
              bullet={['Add unlimited drivers', 'Dispatch from one screen', 'Manage trucks + insurance docs']}
            />
          </div>
          <p className="mt-8 text-center text-sm text-silver-500">
            Both flows live inside the Movvy app. Questions?{' '}
            <a className="font-semibold text-brand-700 underline" href="mailto:partner@movvy.ca">
              partner@movvy.ca
            </a>
          </p>
        </div>
      </section>

      <section className="bg-ink-900 py-16 text-white">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-3xl font-bold">Ready to Start Earning?</h2>
          <p className="mt-3 text-white/80">
            Download Movvy, tap "Become a Partner," and we'll walk you through it.
          </p>
          <div className="mt-7 flex justify-center">
            <StoreBadges align="center" size="lg" />
          </div>
          <Link
            href="/"
            className="mt-8 inline-block text-sm font-semibold text-white/70 underline transition hover:text-white"
          >
            ← Back to Home
          </Link>
        </div>
      </section>
    </>
  );
}

function Tile({
  title,
  body,
  bullet,
}: {
  title: string;
  body: string;
  bullet: string[];
}) {
  return (
    <div className="rounded-3xl border border-silver-200 bg-white p-6">
      <h3 className="text-xl font-bold text-ink-900">{title}</h3>
      <p className="mt-2 text-sm text-silver-600">{body}</p>
      <ul className="mt-4 space-y-2">
        {bullet.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-ink-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19l12-12-1.4-1.4z" />
              </svg>
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
