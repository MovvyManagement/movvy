import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TrackMove } from '@/components/track/TrackMove';

export const metadata: Metadata = {
  title: 'Track Your Move',
  description: 'See your Movvy crew live. Enter your move code and the last 4 digits of your phone number.',
  robots: { index: false, follow: false },
};

export default function TrackPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <TrackMove />
      </Suspense>
    </main>
  );
}
