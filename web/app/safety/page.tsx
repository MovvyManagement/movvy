// =============================================================================
// /safety — Safety Center / crew handbook.
//
// Referenced from both the customer profile (Safety) and the driver / company
// safety hubs in the mobile app:
//   Linking.openURL('https://movvy.ca/safety').
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Safety Center',
  description:
    'How Movvy keeps customers and crews safe — vetted partners, $2M insurance, SOS in-app, 24/7 support.',
};

const pillars = [
  {
    title: 'Every Crew is verified',
    body:
      "We don't onboard a driver until we've verified government ID, driver's license, and vehicle registration. Background checks run before the first job.",
  },
  {
    title: '$2M commercial liability',
    body:
      'Every Movvy move is covered up to two million dollars in damage. If something goes wrong, we open a claim within minutes of you reporting it.',
  },
  {
    title: 'Phone proxy — your number stays private',
    body:
      'When you and your Crew call or text each other, both numbers are masked through a Movvy proxy. Your real number is never shared.',
  },
  {
    title: 'In-app SOS',
    body:
      "One tap from any move screen alerts Movvy support and your emergency contact, with your location and active move ID. We're on the line in under 60 seconds.",
  },
  {
    title: 'Audit trail on every move',
    body:
      'Status changes, locations, and chat are logged with timestamps. You can request a complete audit export of your move at any time.',
  },
];

export default function Safety() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          Safety Center
        </p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">
          We take Movvy day seriously.
        </h1>
        <p className="mt-3 text-base text-silver-600">
          Your home is full of things that matter. Here's how we keep them — and
          you — safe.
        </p>

        <div className="mt-10 grid gap-5">
          {pillars.map((p) => (
            <div
              key={p.title}
              className="rounded-3xl border border-silver-200 bg-white p-6"
            >
              <h2 className="text-lg font-bold text-ink-900">{p.title}</h2>
              <p className="mt-2 text-sm leading-6 text-silver-600">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-3xl border border-brand-100 bg-brand-50 p-6">
          <h2 className="text-lg font-bold text-brand-800">
            No Hidden Charges. Ever.
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-700">
            Movvy bills by the hour at a rate you see before you book. No
            surprise fuel surcharges, no "stairs" upcharges, no "weekend"
            premiums. Final invoice reflects actual time on site — pay less
            if your crew finishes early.
          </p>
        </div>
      </div>
    </article>
  );
}
