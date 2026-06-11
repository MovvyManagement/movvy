# movvy-web

Marketing site for Movvy at **movvy.ca**. Built with Next.js 15 (App Router)
and Tailwind. Brand tokens are mirrored from the mobile app's
`tailwind.config.js` so screenshots and the site share the same palette.

## What's here

```
web/
├── app/
│   ├── layout.tsx          Root shell (Nav + Footer + metadata)
│   ├── page.tsx            Home — Hero, HowItWorks, Cities, ForPartners, FAQ, DownloadCTA
│   ├── partners/           For movers + moving companies
│   ├── legal/              Terms of Service
│   ├── privacy/            PIPEDA-compliant Privacy Policy
│   ├── safety/             Safety Center (referenced from mobile app)
│   ├── training/           Driver training landing
│   ├── join/[code]/        Universal-link landing for partner invites
│   ├── globals.css         Tailwind + Inter
│   └── sitemap.ts          /sitemap.xml generator
├── components/             Nav, Footer, Hero, HowItWorks, Cities,
│                           ForPartners, FAQ, DownloadCTA, StoreBadges,
│                           TrustChips, Logo
└── public/
    ├── robots.txt
    └── .well-known/
        ├── apple-app-site-association   (iOS Universal Links)
        └── assetlinks.json              (Android App Links)
```

## Development

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

The mobile app's CORS allowlist already includes `http://localhost:3000`
so the landing can hit Supabase edge functions in dev if you ever add
a contact form or newsletter signup.

## See also

[DEPLOY.md](./DEPLOY.md) — DNS, Cloudflare Email Routing, Vercel setup,
and the placeholders you need to fill (Apple Team ID, Android SHA256
fingerprint, store URLs).
