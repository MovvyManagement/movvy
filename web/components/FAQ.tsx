// =============================================================================
// FAQ — preempts the most common support-inbox questions. Each Q maps to
// a topic the mobile app already handles (pricing, cancellation, insurance,
// service area).
// =============================================================================

'use client';

import { useState } from 'react';

const faqs = [
  {
    q: 'How much does a Movvy move cost?',
    // The old copy promised "$400–$700 all-in" for this exact move. The engine
    // has never produced a number in that range: the cheapest quote it can
    // generate for anything is $1,300 (a 1-bedroom apartment), and a 2-bedroom
    // prices at $1,667 — 8.5 hours at $175/hr for a two-person crew, plus fuel,
    // materials and GST. Advertising less than half the real figure gets people
    // to the estimate screen and loses them there. Keep this in step with
    // lookupResidential() in src/lib/pricing.ts.
    a: "Honest hourly pricing — you pay for the actual time the crew spends on site, plus travel, materials and GST. A two-person crew is $175/hr, and a typical 2-bedroom Calgary move works out around $1,650 all-in for about eight and a half hours. You see a live estimate the moment you enter your addresses, and you're billed on the real time the move takes.",
  },
  {
    q: 'Can I cancel after I book?',
    a: 'Yes. Cancel more than 48 hours before your move and your 20% deposit is fully refunded. Inside 48 hours the deposit is non-refundable — it goes straight to the crew who held the slot for you.',
  },
  {
    q: 'Are the movers insured?',
    // "the in-app claim flow" no longer exists — the claim, dispute and audit
    // screens were removed and Customer Service now opens a chat with a person,
    // who raises the claim from the thread. Describe the door that's actually
    // there.
    a: 'Every Movvy crew carries $2M commercial liability insurance and is background-checked before their first job. If something ever goes wrong, open Customer Service in the app — it puts you straight into a chat with our support team, and they handle the claim from there.',
  },
  {
    q: "What if I don't need a full move — just one heavy item?",
    a: 'Choose "Commercial & other" in the app, then pick "Single items" or "Labour only". Same vetted crews, billed hourly with a 4-hour minimum. Great for a couch, a fridge, or just an extra set of hands for the day.',
  },
  {
    q: 'Which cities are covered?',
    // Must match MAJOR_CITIES in src/lib/distance.ts — the app prices and
    // dispatches against those ten, so any shorter list here turns away
    // customers Movvy can actually serve. This said "Calgary, Edmonton, and
    // Red Deer" while the app already covered all ten.
    a: "Live in Calgary, Edmonton, Red Deer, Lethbridge, Medicine Hat, Grande Prairie, Fort McMurray, Airdrie, St. Albert, and Okotoks. Long-distance moves between supported cities work too — they're just priced by the kilometre instead of by the hour.",
  },
  {
    q: 'How do I get paid as a driver or mover?',
    a: 'Weekly direct deposit straight to your Canadian bank account. Your earnings update in the app the moment a job completes — no waiting for an invoice cycle.',
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-white py-20">
      <div className="mx-auto max-w-3xl px-5">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">FAQ</p>
          <h2 className="mt-2 text-3xl font-bold text-ink-900 sm:text-4xl">
            The Quick Answers, Before You Tap Download.
          </h2>
        </div>

        <div className="divide-y divide-silver-200 rounded-2xl border border-silver-200 bg-white">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-silver-50"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-semibold text-ink-900">{f.q}</span>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-silver-100 transition ${
                      isOpen ? 'rotate-45 bg-brand-50 text-brand-700' : 'text-ink-700'
                    }`}
                    aria-hidden
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-5 pb-5 text-sm leading-6 text-silver-600">
                    {f.a}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-silver-500">
          Still curious? Email{' '}
          <a className="font-semibold text-brand-700 underline" href="mailto:support@movvy.ca">
            support@movvy.ca
          </a>{' '}
          and we'll write back the same day.
        </p>
      </div>
    </section>
  );
}
