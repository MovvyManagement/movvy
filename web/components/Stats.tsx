// =============================================================================
// Stats band — four big numbers framed in moovy.ca-style brackets to give
// the page a "real company, not a side project" credibility punch right
// after the hero.
//
// Numbers should track real data once we have it; for now the values
// mirror what we advertise everywhere else (4.9★, $2M insurance, etc.).
// =============================================================================

const stats = [
  { value: '4.9★', label: 'Customer rating' },
  { value: '$2M', label: 'Damage coverage' },
  { value: '60s', label: 'To book a move' },
  { value: '100%', label: 'Vetted Alberta crews' },
];

export function Stats() {
  return (
    <section className="relative border-y border-silver-200 bg-white py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="relative flex flex-col items-center">
              {/* Bracket corners — pure CSS, no images. Matches moovy.ca's
                  decorative framing. */}
              <span
                aria-hidden
                className="absolute left-2 top-0 h-4 w-4 border-l-2 border-t-2 border-brand-300/70 md:left-6"
              />
              <span
                aria-hidden
                className="absolute right-2 top-0 h-4 w-4 border-r-2 border-t-2 border-brand-300/70 md:right-6"
              />
              <span
                aria-hidden
                className="absolute bottom-0 left-2 h-4 w-4 border-b-2 border-l-2 border-brand-300/70 md:left-6"
              />
              <span
                aria-hidden
                className="absolute bottom-0 right-2 h-4 w-4 border-b-2 border-r-2 border-brand-300/70 md:right-6"
              />

              <p className="text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
                {s.value}
              </p>
              <p className="mt-2 text-xs font-bold uppercase tracking-wider text-silver-500">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
