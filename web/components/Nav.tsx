// =============================================================================
// Top nav — shared on every page.
//
// Conversion-first: the primary CTA on every screen is "Get the app." The
// other links are nav-supportive (For movers · Cities · FAQ), nothing that
// could distract a download-ready visitor.
// =============================================================================

import Link from 'next/link';
import { Logo } from './Logo';

const navLinks = [
  { href: '/partners', label: 'For Movers' },
  { href: '/#cities', label: 'Cities' },
  { href: '/#faq', label: 'FAQ' },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-silver-200 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Movvy home">
          <Logo size={28} />
          <span className="text-lg font-bold tracking-tight text-ink-900">Movvy</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ink-700 transition hover:text-brand-700"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <Link
          href="/#download"
          className="rounded-full bg-ink-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700"
        >
          Get the App
        </Link>
      </nav>
    </header>
  );
}
