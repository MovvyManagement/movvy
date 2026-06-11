// =============================================================================
// Root layout — applied to every page.
//
// Sets up metadata for SEO + social previews, Inter font, and the shared
// chrome (Nav + Footer) so every page renders identically below the fold.
// =============================================================================

import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

const TITLE = 'Movvy — Your Move, Booked in 60 Seconds';
const DESCRIPTION =
  "Alberta's moving marketplace. Vetted crews, honest hourly pricing, live tracking " +
  'from pickup to drop-off. Calgary, Edmonton, Red Deer, and beyond.';

export const metadata: Metadata = {
  metadataBase: new URL('https://movvy.ca'),
  title: {
    default: TITLE,
    template: '%s · Movvy',
  },
  description: DESCRIPTION,
  applicationName: 'Movvy',
  keywords: [
    'moving Calgary',
    'movers Calgary',
    'moving Edmonton',
    'Alberta moving company',
    'moving app',
    'book movers',
  ],
  authors: [{ name: 'Movvy Technologies Inc.' }],
  openGraph: {
    type: 'website',
    locale: 'en_CA',
    url: 'https://movvy.ca',
    siteName: 'Movvy',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Movvy — moving day, sorted in 60 seconds',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-CA">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
