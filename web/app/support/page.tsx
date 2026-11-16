// =============================================================================
// /support — how to reach Movvy, plus the questions people ask most.
//
// The App Store listing's Support URL points here, and Apple's reviewers check
// it has a working way to contact us. Every answer below matches what the app
// and website actually do today (48-hour cancellation rule, 20% deposit, 9–11
// AM arrival window, move-code tracking). Change the answer when the product
// changes, never the other way round.
// =============================================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with a Movvy move, a payment, or your account.',
};

const SUPPORT_EMAIL = 'support@movvy.ca';
const PARTNER_EMAIL = 'partner@movvy.ca';

const questions: { q: string; a: ReactNode }[] = [
  {
    q: 'Where does Movvy operate?',
    a: 'Movvy books moves within Alberta.',
  },
  {
    q: 'How do I book a move?',
    a: (
      <>
        In the Movvy app or at <Link href="/book" className="font-semibold text-brand-700 underline underline-offset-2">movvy.ca/book</Link>.
        You see the price before you book, and a 20% deposit confirms it. The deposit counts toward your
        final bill.
      </>
    ),
  },
  {
    q: 'When will my crew arrive?',
    a: 'Crews arrive between 9:00 and 11:00 AM on your move day. You can follow them on the map once they leave.',
  },
  {
    q: 'How do I track my move?',
    a: (
      <>
        In the app, or at <Link href="/track" className="font-semibold text-brand-700 underline underline-offset-2">movvy.ca/track</Link> with
        your move code (it looks like MV-1234) and the last 4 digits of your phone number.
      </>
    ),
  },
  {
    q: 'How do I change or cancel a move?',
    a: 'Open the move in the app, or on the tracking page after signing in. Cancel more than 48 hours before your move and your deposit is refunded in full. Within 48 hours, the deposit is kept.',
  },
  {
    q: 'How do refunds work?',
    a: 'Refunds go back to the card you paid with. They usually appear within 5 to 10 business days, depending on your bank.',
  },
  {
    q: 'How is the final price worked out?',
    a: "Your bill is based on the time the move actually takes, so a faster move costs less. The receipt in the app shows every line, and your deposit is taken off the total.",
  },
  {
    q: 'Something was damaged. What do I do?',
    a: `Tell us as soon as you can, in the app or by email at ${SUPPORT_EMAIL}, with photos of the damage and your move code. We'll work through it with you and the crew.`,
  },
  {
    q: 'How do I delete my account?',
    a: (
      <>
        From Profile in the app, or by email. The steps, and what is deleted and kept, are on{' '}
        <Link href="/delete-account" className="font-semibold text-brand-700 underline underline-offset-2">Delete your account</Link>.
      </>
    ),
  },
];

export default function Support() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Help</p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">Support</h1>
        <p className="mt-4 text-base leading-7 text-silver-600">
          Questions about a move, a payment or your account? Email us and a person from Movvy will reply.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-silver-200 p-5">
            <h2 className="text-sm font-bold text-ink-900">Email</h2>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-1 block text-lg font-semibold text-brand-700 underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
            <p className="mt-2 text-sm leading-6 text-silver-600">
              Include your move code if your question is about a move.
            </p>
          </div>
          <div className="rounded-2xl border border-silver-200 p-5">
            <h2 className="text-sm font-bold text-ink-900">In the app</h2>
            <p className="mt-1 text-sm leading-6 text-silver-600">
              Open <span className="font-semibold text-ink-900">Profile</span>, then{' '}
              <span className="font-semibold text-ink-900">Customer Service</span>, to chat with Movvy. During a
              move, the chat button on the move reaches your crew.
            </p>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-bold text-ink-900">Common questions</h2>
          <dl className="mt-4 divide-y divide-silver-200 border-y border-silver-200">
            {questions.map(({ q, a }) => (
              <div key={q} className="py-5">
                <dt className="text-base font-semibold text-ink-900">{q}</dt>
                <dd className="mt-2 text-sm leading-6 text-silver-600">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold text-ink-900">Movers and moving companies</h2>
          <p className="mt-3 text-sm leading-6 text-silver-600">
            Want to take jobs on Movvy, or need help with your crew account? See{' '}
            <Link href="/partners" className="font-semibold text-brand-700 underline underline-offset-2">For Movers &amp; Companies</Link>{' '}
            or email{' '}
            <a href={`mailto:${PARTNER_EMAIL}`} className="font-semibold text-brand-700 underline underline-offset-2">{PARTNER_EMAIL}</a>.
          </p>
        </section>

        <p className="mt-12 text-sm leading-6 text-silver-500">
          See also our <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link> and{' '}
          <Link href="/legal" className="underline underline-offset-2">Terms of Service</Link>.
        </p>
      </div>
    </article>
  );
}
