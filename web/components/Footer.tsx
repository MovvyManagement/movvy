// =============================================================================
// Site footer — secondary nav, legal, and contact inboxes.
//
// Inboxes match the Cloudflare Email Routing setup in DEPLOY.md. Anything
// that hits these forwards to a real inbox the user owns.
// =============================================================================

import Link from 'next/link';
import { Wordmark } from './Logo';
import { HiddenAdminTrigger } from './HiddenAdminTrigger';

const columns = [
  {
    title: 'Movvy',
    links: [
      { href: '/', label: 'Home' },
      { href: '/partners', label: 'For Movers & Companies' },
      { href: '/#cities', label: 'Cities We Serve' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Get the App',
    links: [
      { href: 'https://apps.apple.com/ca/app/movvy/idTODO', label: 'iOS · App Store' },
      { href: 'https://play.google.com/store/apps/details?id=com.movvy.app', label: 'Android · Play Store' },
    ],
  },
  {
    title: 'Help',
    links: [
      { href: 'mailto:support@movvy.ca', label: 'support@movvy.ca' },
      { href: 'mailto:partner@movvy.ca', label: 'partner@movvy.ca' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/legal', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/safety', label: 'Safety Center' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-silver-200 bg-silver-50">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-silver-500">
                {col.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-700 transition hover:text-brand-700"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-silver-200 pt-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            {/* Triple-click the Movvy logo → admin console login.
                Invisible to anyone who doesn't already know it's there.
                Cmd/Ctrl+Shift+M anywhere on the page does the same. */}
            <HiddenAdminTrigger>
              <Wordmark size={20} />
            </HiddenAdminTrigger>
          </div>
          <p className="text-xs text-silver-500">
            © {new Date().getFullYear()} Movvy Technologies Inc. · Calgary, AB · Built in Canada
          </p>
        </div>
      </div>
    </footer>
  );
}
