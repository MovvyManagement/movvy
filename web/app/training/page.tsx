// =============================================================================
// /training — driver training videos.
//
// Referenced from /(mover)/safety + /(company)/safety in the mobile app.
// For now it's a placeholder explainer; once real training videos are
// recorded, swap the placeholder cards for embedded YouTube/Vimeo players.
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Driver Training',
  description:
    'Movvy driver training — how to handle furniture, packing best practices, customer interaction, and safety on the road.',
};

const modules = [
  {
    n: '01',
    title: 'Day-of checklist',
    duration: '4 min',
    body: 'What to bring, what to inspect, and how to start a job clean.',
  },
  {
    n: '02',
    title: 'Lifting + carrying technique',
    duration: '7 min',
    body: 'Protect your back, the customer’s walls, and the furniture.',
  },
  {
    n: '03',
    title: 'Packing fragile items',
    duration: '6 min',
    body: 'Glassware, art, electronics — what to wrap and how to stack.',
  },
  {
    n: '04',
    title: 'Customer interaction',
    duration: '5 min',
    body: 'First-impression script, handling complaints, and what to do when something breaks.',
  },
  {
    n: '05',
    title: 'Truck loading order',
    duration: '8 min',
    body: 'Heaviest first, fragile last, what goes against the cab wall and why.',
  },
];

export default function Training() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          For Movvy partners
        </p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">Driver training</h1>
        <p className="mt-3 text-base text-silver-600">
          Optional but recommended — Movvy partners who complete the training
          earn a "Trained" badge that customers see on the live tracking screen.
        </p>

        <div className="mt-10 grid gap-4">
          {modules.map((m) => (
            <div
              key={m.n}
              className="flex items-center gap-4 rounded-3xl border border-silver-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-base font-bold text-brand-700">
                {m.n}
              </span>
              <div className="flex-1">
                <h2 className="text-base font-bold text-ink-900">{m.title}</h2>
                <p className="mt-0.5 text-sm text-silver-600">{m.body}</p>
              </div>
              <span className="rounded-full bg-silver-100 px-3 py-1 text-xs font-bold text-ink-700">
                {m.duration}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-silver-500">
          Videos are recorded and rolling out. Questions:{' '}
          <a className="font-semibold text-brand-700 underline" href="mailto:partner@movvy.ca">
            partner@movvy.ca
          </a>
        </p>
      </div>
    </article>
  );
}
