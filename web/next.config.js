const path = require('path');

/** @type {import('next').NextConfig} */
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
  // Belt-and-suspenders for the same monorepo confusion when Next runs the
  // server-trace step (used by serverless output on Vercel).
  outputFileTracingRoot: path.resolve(__dirname),
  // Universal-link manifests need a specific Content-Type or iOS / Android
  // refuse to verify them.
  async headers() {
    return [
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
