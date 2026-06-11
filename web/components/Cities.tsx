// =============================================================================
// Cities we serve — pulled from the same shortlist seeded in the mobile
// app's `cities` table (Calgary first, then the rest of Alberta).
// =============================================================================

const cities = [
  { name: 'Calgary', live: true },
  { name: 'Edmonton', live: true },
  { name: 'Red Deer', live: true },
  { name: 'Lethbridge', live: false },
  { name: 'Medicine Hat', live: false },
  { name: 'Fort McMurray', live: false },
];

export function Cities() {
  return (
    <section id="cities" className="bg-silver-50 py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Where Movvy Moves
          </p>
          <h2 className="mt-2 text-3xl font-bold text-ink-900 sm:text-4xl">
            Calgary, Edmonton, and Growing Across Alberta.
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {cities.map((c) => (
            <div
              key={c.name}
              className={`rounded-2xl border p-4 ${
                c.live
                  ? 'border-brand-200 bg-white text-ink-900'
                  : 'border-silver-200 bg-white/60 text-silver-500'
              }`}
            >
              <p className="text-base font-bold">{c.name}</p>
              <p className={`mt-1 text-xs ${c.live ? 'text-brand-700' : 'text-silver-400'}`}>
                {c.live ? 'Live' : 'Coming soon'}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-silver-500">
          Need a move in a city not listed? Email{' '}
          <a className="font-semibold text-brand-700 underline" href="mailto:support@movvy.ca">
            support@movvy.ca
          </a>{' '}
          — we add new markets every month.
        </p>
      </div>
    </section>
  );
}
