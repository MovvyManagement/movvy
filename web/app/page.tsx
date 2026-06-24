// =============================================================================
// Home — movvy.ca/
//
// Conversion-funnel layout, top to bottom:
//   1. Hero          → big branded photo + value prop + store badges
//   2. Stats         → moovy.ca-style bracketed credibility band
//   3. HowItWorks    → 3-step explanation (what does the app do?)
//   4. AppShowcase   → real in-app screenshots (booking + live tracking)
//   5. Lifestyle     → humanizing band (woman with Movvy boxes)
//   6. Cities        → social proof + service area
//   7. ForPartners   → secondary audience, anchored by a crew photo
//   8. FAQ           → preempt support email volume
//   9. DownloadCTA   → final push to the App Store / Play Store
//
// The site is intentionally read-only: there is no booking form here. The
// only action a visitor can take is "download the app."
// =============================================================================

import { Hero } from '@/components/Hero';
import { Stats } from '@/components/Stats';
import { HowItWorks } from '@/components/HowItWorks';
import { AppShowcase } from '@/components/AppShowcase';
import { Lifestyle } from '@/components/Lifestyle';
import { Cities } from '@/components/Cities';
import { ForPartners } from '@/components/ForPartners';
import { FAQ } from '@/components/FAQ';
import { DownloadCTA } from '@/components/DownloadCTA';

export default function Home() {
  return (
    <>
      <Hero />
      <Stats />
      <HowItWorks />
      <AppShowcase />
      <Lifestyle />
      <Cities />
      <ForPartners />
      <FAQ />
      <DownloadCTA />
    </>
  );
}
