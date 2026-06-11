// =============================================================================
// "How It Works" — the 3-step explanation that does the heavy lifting on
// why visitors should download the app instead of poking around. Each step
// has a tiny iconographic illustration; replace with real screenshots
// later if the brand kit ships them.
// =============================================================================

const steps = [
  {
    n: '01',
    title: 'Tell Us Where You\'re Going',
    body:
      'Pickup, drop-off, and a date. That\'s it. No 20-question quote form, no calls back, no quote tag.',
    icon: <PinIcon />,
  },
  {
    n: '02',
    title: 'We Send a Vetted Crew',
    body:
      'A background-checked, fully insured Movvy team accepts your job in minutes. You see their photo, rating, and arrival window the moment they\'re assigned.',
    icon: <PeopleIcon />,
  },
  {
    n: '03',
    title: 'Track Every Move',
    body:
      'Live GPS from pickup to drop-off. Message your crew in-app. Honest, transparent hourly pricing on a receipt you can save the moment the job\'s done.',
    icon: <MapIcon />,
  },
];

export function HowItWorks() {
  return (
    <section className="bg-white py-20" id="how">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-12 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            How It Works
          </p>
          <h2 className="mt-2 text-3xl font-bold text-ink-900 sm:text-4xl">
            From Tap to Truck in Under a Minute.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-silver-600">
            Three taps gets you a real crew. Everything else — payment,
            tracking, chat with your crew, receipts — lives in the app.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="group rounded-3xl border border-silver-200 bg-white p-6 transition hover:border-brand-300 hover:shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-silver-200 transition group-hover:text-brand-200">
                  {s.n}
                </span>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                  {s.icon}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-ink-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-silver-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.7 0-8 1.3-8 4v2h11v-2c0-.8.2-1.6.6-2.3-1.1-.5-2.4-.7-3.6-.7zm8 0c-.3 0-.7 0-1 .1 1.9 1.4 2 3.4 2 3.4v2h7v-2c0-2.7-5.3-3.5-8-3.5z" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" />
    </svg>
  );
}
