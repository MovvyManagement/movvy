/** @type {import('next').NextConfig} */

// ─── Security headers ────────────────────────────────────────────────────────
// Applied to every route. Vercel already sets HSTS for HTTPS, but everything
// else below is explicit so we don't rely on any host's defaults.
//
// Content-Security-Policy notes:
//   • 'unsafe-inline' + 'unsafe-eval' in script-src is unavoidable for a
//     Next.js App Router site — the runtime needs both for hydration + RSC
//     stream. Trade-off accepted; XSS defense-in-depth is still meaningful
//     because it locks down origins for images, connect, frames, media.
//   • connect-src includes wss://*.supabase.co for the Realtime WebSocket
//     that powers admin live updates + support chat.
//   • img-src includes data: for the SVG icons we inline everywhere +
//     https: for Supabase Storage signed URLs (verification docs, receipts).
//   • frame-ancestors 'none' is the modern replacement for X-Frame-Options:
//     nothing can iframe movvy.ca — kills clickjacking + login-form fake-out.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://api.resend.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

// The booking and live tracking pages also load Stripe's card fields and
// Google's map. Only those two pages get the wider policy, so the admin console
// and the rest of the site keep the strict one above.
const CHECKOUT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://api.stripe.com https://r.stripe.com https://m.stripe.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const CHECKOUT_HEADERS = [
  { key: 'Content-Security-Policy', value: CHECKOUT_CSP },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=(self "https://js.stripe.com")',
      'usb=()',
    ].join(', '),
  },
];

const SECURITY_HEADERS = [
  // Prevents the browser from MIME-sniffing an intended text/plain into
  // something executable (script injection defense-in-depth).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt for `frame-ancestors 'none'`. Old browsers ignore CSP; this
  // covers them.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Strip most referrer info when navigating cross-origin. Prevents
  // /admin-management/support/<thread_id> from leaking to google.com etc.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Explicitly deny access to browser features we never use. Reduces
  // attack surface if a script somehow escapes CSP.
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
  // Belt & suspenders HSTS — Vercel sets this on HTTPS but explicit is
  // better than "we hope Vercel keeps doing this." 2-year max-age +
  // includeSubDomains hits the preload eligibility bar.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: CSP,
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin Turbopack's workspace root to THIS folder. Without it, Turbopack
  // walks up the tree, sees the Expo mobile app's package-lock.json at the
  // monorepo root, and infers the wrong workspace — which on Vercel makes
  // the build produce no Next.js output and every route returns 404.
  // See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      // ─── Security headers — every route ─────────────────────────────────
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      // ─── Booking + tracking — must come after the rule above to override it
      { source: '/book', headers: CHECKOUT_HEADERS },
      { source: '/track', headers: CHECKOUT_HEADERS },
      // ─── Universal-link manifests — need specific Content-Type ─────────
      // These override the security headers above just for the file's own
      // Content-Type; the security headers still apply.
      {
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
  // Canonicalize www → apex so SEO doesn't split between two hosts.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.movvy.ca' }],
        destination: 'https://movvy.ca/:path*',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
