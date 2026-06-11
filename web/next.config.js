/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
