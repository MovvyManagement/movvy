import type { Metadata } from 'next';
import { BookingFlow } from '@/components/booking/BookingFlow';

export const metadata: Metadata = {
  title: 'Book a Move',
  description: 'Book a vetted Alberta moving crew online. Instant estimate, honest hourly pricing and live tracking.',
};

export default function BookPage() {
  return (
    <main>
      <BookingFlow />
    </main>
  );
}
