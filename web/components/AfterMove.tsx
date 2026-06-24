// =============================================================================
// AfterMove — the emotional close. Full-bleed atmospheric shot (woman with
// wine, city skyline at night, "Move Complete" on her phone). Last band
// before the final download CTA — sells the *feeling*, not the feature.
//
// Goal: make the visitor picture themselves on the other side of moving day,
// so the "Get the App" button below it feels obvious instead of pushy.
// =============================================================================

import Image from 'next/image';
import { StoreBadges } from './StoreBadges';

export function AfterMove() {
  return (
    <section className="relative overflow-hidden bg-ink-900 text-white">
      {/* Background photo — full bleed */}
      <Image
        src="/marketing/move-complete-night.jpg"
        alt="A woman sitting on the floor of her new high-rise condo at night, holding a glass of red wine, looking out at a glittering city skyline. Moving boxes around her, with her iPhone resting on a box showing the Movvy 'Move Complete' confirmation screen."
        fill
        className="object-cover object-center"
        sizes="100vw"
      />

      {/* Dark scrim — keeps the copy legible on either column at any width */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-ink-900/95 via-ink-900/70 to-ink-900/10"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent"
      />

      <div className="relative mx-auto max-w-6xl px-5 py-28 md:py-36">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-400">
            After the Move
          </p>
          <h2 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-[56px]">
            Stress unpacked.<br />
            <span className="bg-gradient-to-r from-brand-300 to-brand-500 bg-clip-text text-transparent">
              Life resumed.
            </span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-white/80 md:text-lg">
            Boxes off the truck. Crew on their way home. Your phone says
            <em className="not-italic font-semibold text-white"> Move Complete</em>
            {' '}— and the evening, finally, is yours.
          </p>

          <div className="mt-10">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white/70">
              Get the App
            </p>
            <StoreBadges size="lg" />
          </div>
        </div>
      </div>
    </section>
  );
}
