// =============================================================================
// Home — movvy.ca/
//
// Conversion-funnel layout, top to bottom:
//   1. Hero          → grab attention, deliver value prop, show CTA
//   2. HowItWorks    → 3-step explanation (what does the app do?)
//   3. Cities        → social proof + service area
//   4. ForPartners   → secondary audience (movers / companies)
//   5. FAQ           → preempt support email volume
//   6. DownloadCTA   → final push to the App Store / Play Store
//
// The site is intentionally read-only: there is no booking form here. The
// only action a visitor can take is "download the app."
// =============================================================================

import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Cities } from '@/components/Cities';
import { ForPartners } from '@/components/ForPartners';
import { FAQ } from '@/components/FAQ';
import { DownloadCTA } from '@/components/DownloadCTA';

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Cities />
      <ForPartners />
      <FAQ />
      <DownloadCTA />
    </>
  );
}
