// =============================================================================
// /join/[code] — partner-invite deep link landing.
//
// The mobile app advertises this URL in SMS / email invites:
//   https://movvy.ca/join/CO-9X4M2P
//
// Flow:
//   1. iOS / Android Universal Links should open the Movvy app directly
//      (handled by /.well-known/apple-app-site-association + assetlinks.json).
//   2. If the app isn't installed, the user lands here. We show the invite
//      code in a card and link to the App Store / Play Store.
//   3. After install, the app opens to /(mover) /(company) join flow which
//      reads the same code from clipboard or deep link parameters.
//
// Server-rendered (no client JS) so SMS preview crawlers see the right OG.
// =============================================================================

import type { Metadata } from 'next';
import { StoreBadges } from '@/components/StoreBadges';
import Link from 'next/link';

type Props = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Join Movvy with code ${code}`,
    description: `You've been invited to join a Movvy crew. Download the app and enter code ${code} to accept.`,
  };
}

export default async function JoinLanding({ params }: Props) {
  const { code } = await params;
  return (
    <section className="bg-gradient-to-br from-white via-brand-50 to-white py-20">
      <div className="mx-auto max-w-2xl px-5 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M19 8H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-9a2 2 0 00-2-2zm-7-6a4 4 0 00-4 4h2a2 2 0 014 0h2a4 4 0 00-4-4z" />
          </svg>
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          You've been invited to Movvy
        </p>
        <h1 className="mt-2 text-3xl font-bold text-ink-900 sm:text-4xl">
          Download the app to accept.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-base text-silver-600">
          A Movvy partner added you to their crew. Open the app and enter your
          invite code to start receiving job offers.
        </p>

        <div className="mx-auto mt-8 max-w-sm rounded-3xl border border-brand-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-silver-500">
            Your invite code
          </p>
          <p className="mt-1 select-all font-mono text-3xl font-bold tracking-widest text-ink-900">
            {code}
          </p>
        </div>

        <div className="mt-8 flex justify-center">
          <StoreBadges align="center" size="lg" />
        </div>

        <p className="mt-8 text-sm text-silver-500">
          Already have the app? Open it and the invite will appear automatically.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block text-sm font-semibold text-silver-500 underline transition hover:text-ink-900"
        >
          ← Movvy home
        </Link>
      </div>
    </section>
  );
}
