// =============================================================================
// MeetCrew — humanizes the "vetted crew" promise with a real portrait of
// a Movvy crew lead in uniform, standing in front of a branded truck.
//
// Sits between HowItWorks and AppShowcase so the visitor goes:
//   "Here's what the app does" → "Here's who shows up" → "Here's the app."
// =============================================================================

import Image from 'next/image';

const guarantees = [
  {
    title: 'Background-checked',
    body: 'Criminal record check + reference verification before a crew can claim a single job.',
  },
  {
    title: 'Photo + name tag',
    body: 'You see your crew lead\'s face the moment they\'re assigned — same person who knocks on your door.',
  },
  {
    title: 'Rated every move',
    body: 'Drop below 4.5 stars and you\'re off the platform. No exceptions, no second chances on safety.',
  },
];

export function MeetCrew() {
  return (
    <section className="relative bg-white py-24" id="crew">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 md:grid-cols-[1fr_1.05fr] md:gap-16">
        {/* Image side */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-brand-100 via-brand-50 to-transparent blur-2xl"
          />
          <Image
            src="/marketing/crew-portrait.jpg"
            alt="A smiling Movvy crew lead wearing a black uniform polo with a green Movvy name tag, holding a clipboard, standing in front of a Movvy-branded white box truck on a sunny tree-lined suburban street."
            width={1140}
            height={1408}
            className="w-full rounded-3xl object-cover shadow-[0_30px_70px_-20px_rgba(4,120,87,0.3)] ring-1 ring-black/5"
          />

          {/* Floating credential badge */}
          <div className="absolute -bottom-5 -right-3 hidden items-center gap-3 rounded-2xl border border-brand-100 bg-white/95 px-4 py-3 shadow-xl backdrop-blur sm:flex md:-right-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-bold uppercase tracking-wider text-silver-500">
                Verified
              </p>
              <p className="text-sm font-bold text-ink-900">Crew Lead · 4.9★</p>
            </div>
          </div>
        </div>

        {/* Copy side */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Meet Your Crew
          </p>
          <h2 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl md:text-5xl">
            Real people.<br />
            Real uniforms.<br />
            <span className="bg-gradient-to-r from-brand-700 to-brand-500 bg-clip-text text-transparent">
              Real accountability.
            </span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-silver-600">
            Every Movvy mover is vetted, uniformed, and rated by every customer
            they serve. The crew lead you see in the app is the same person who
            shows up at your door.
          </p>

          <div className="mt-8 space-y-5">
            {guarantees.map((g) => (
              <div key={g.title} className="flex items-start gap-4">
                <span className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div>
                  <p className="text-base font-bold text-ink-900">{g.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-silver-600">{g.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
