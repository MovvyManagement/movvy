// =============================================================================
// Closing "download the app" CTA. Sits right above the footer so anyone who
// scrolls the whole page gets one final, unmissable shot at the conversion.
// Mirrors the hero's badges but with bigger emphasis and a different framing.
// =============================================================================

import { StoreBadges } from './StoreBadges';

export function DownloadCTA() {
  return (
    <section id="download" className="bg-gradient-to-br from-brand-700 to-brand-500 py-20 text-white">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">
          Your Next Move Lives in the App.
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-base text-white/85">
          Booking. Live tracking. Chat with your crew. Receipts. All in one
          place, on iOS and Android. The website's just here to send you there.
        </p>
        <div className="mt-8 flex justify-center">
          <StoreBadges size="lg" align="center" />
        </div>
        <p className="mt-6 text-xs text-white/70">
          Free to Download · No Subscription · Honest Hourly Pricing
        </p>
      </div>
    </section>
  );
}
