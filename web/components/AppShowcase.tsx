// =============================================================================
// AppShowcase — two alternating feature blocks anchored by real in-app
// screenshots. Image 4 ("Your move is booked!") + Image 5 ("Live tracking")
// do the heavy lifting; the copy explains the value prop next to each.
//
// On mobile, the image always renders above the text (visual first, then
// context). On desktop, we alternate left/right to keep the eye moving.
// =============================================================================

import Image from 'next/image';

interface Feature {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  image: string;
  imageAlt: string;
  reverse?: boolean;
}

const features: Feature[] = [
  {
    eyebrow: 'Booking',
    title: 'Confirmed before you finish your coffee.',
    body:
      'Three taps, real crew, locked-in window. You see your mover\'s photo, rating, and arrival time the moment a job is accepted.',
    bullets: [
      'Live, vetted crews — no marketplace bidding',
      'Photo, rating + vehicle of your mover',
      'Transparent flat estimate before you confirm',
    ],
    image: '/marketing/app-booking-confirmed.jpg',
    imageAlt:
      'iPhone showing the Movvy booking confirmation screen with the crew lead Marco, their 4.9 star rating, the move date and time, pickup and drop-off addresses, and the total cost.',
  },
  {
    eyebrow: 'Live tracking',
    title: 'Watch your move, in real time.',
    body:
      'GPS pin from "we\'ve left HQ" through final drop-off, with one-tap call and chat to your crew. No more "are they coming?" texts.',
    bullets: [
      'Live GPS from pickup to drop-off',
      'In-app call + chat, no number sharing',
      'Live ETA + billing timer once on the clock',
    ],
    image: '/marketing/app-live-tracking.jpg',
    imageAlt:
      'iPhone showing a live map with a green route from Glen Park to Nob Hill, the Movvy truck halfway along the route, and an ETA of 12:40 PM. Call and chat buttons sit at the bottom.',
    reverse: true,
  },
];

export function AppShowcase() {
  return (
    <section className="relative bg-gradient-to-b from-white via-silver-50 to-white py-24" id="app">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-16 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Inside the App
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl md:text-5xl">
            Every step of your move,<br className="hidden sm:block" /> in your pocket.
          </h2>
        </div>

        <div className="space-y-24 md:space-y-32">
          {features.map((f) => (
            <div
              key={f.title}
              className={`grid items-center gap-12 md:grid-cols-2 md:gap-16 ${
                f.reverse ? 'md:[&>*:first-child]:order-2' : ''
              }`}
            >
              {/* Image side */}
              <div className="relative flex justify-center">
                <div className="relative w-full max-w-[400px]">
                  <div
                    aria-hidden
                    className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-brand-200/50 via-brand-50 to-transparent blur-2xl"
                  />
                  <Image
                    src={f.image}
                    alt={f.imageAlt}
                    width={1140}
                    height={1480}
                    className="w-full rounded-[28px] object-cover shadow-[0_30px_70px_-20px_rgba(4,120,87,0.3)] ring-1 ring-black/5"
                  />
                </div>
              </div>

              {/* Copy side */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
                  {f.eyebrow}
                </p>
                <h3 className="mt-2 text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
                  {f.title}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-silver-600">
                  {f.body}
                </p>
                <ul className="mt-7 space-y-3">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="text-sm font-medium text-ink-900">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
