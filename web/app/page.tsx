// =============================================================================
// Home — movvy.ca/
//
// Conversion-funnel layout, top to bottom:
//   1.  Hero          → big branded photo + value prop + store badges
//   2.  Stats         → moovy.ca-style bracketed credibility band
//   3.  HowItWorks    → 3-step explanation (what does the app do?)
//   4.  MeetCrew      → portrait of a real crew lead in uniform
//   5.  AppShowcase   → real in-app screenshots (booking + live tracking)
//   6.  Lifestyle     → humanizing band (moving day, reimagined)
//   7.  Cities        → social proof + service area
//   8.  ForPartners   → secondary audience, anchored by a crew photo
//   9.  FAQ           → preempt support email volume
//   10. AfterMove     → emotional close, full-bleed night shot
//   11. DownloadCTA   → final push to the App Store / Play Store
//
// The site is intentionally read-only: there is no booking form here. The
// only action a visitor can take is "download the app."
// =============================================================================

import { Hero } from '@/components/Hero';
import { Stats } from '@/components/Stats';
import { HowItWorks } from '@/components/HowItWorks';
import { MeetCrew } from '@/components/MeetCrew';
import { AppShowcase } from '@/components/AppShowcase';
import { Lifestyle } from '@/components/Lifestyle';
import { Cities } from '@/components/Cities';
import { ForPartners } from '@/components/ForPartners';
import { FAQ } from '@/components/FAQ';
import { AfterMove } from '@/components/AfterMove';
import { DownloadCTA } from '@/components/DownloadCTA';

export default function Home() {
  return (
    <>
      <Hero />
      <Stats />
      <HowItWorks />
      <MeetCrew />
      <AppShowcase />
      <Lifestyle />
      <Cities />
      <ForPartners />
      <FAQ />
      <AfterMove />
      <DownloadCTA />
    </>
  );
}
