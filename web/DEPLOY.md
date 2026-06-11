# Deploying movvy.ca

A complete walkthrough from "I own the domain" to "the site is live and
the app's universal links work."

Estimated time: **30 minutes** once you have Cloudflare and Vercel accounts.

---

## Step 1 — Push the code and connect Vercel

```bash
cd /Users/adamhmedat/Desktop/Movvy
git add web/
git commit -m "Add Next.js landing page at web/"
git push
```

In Vercel:

1. **Add New Project** → import the Movvy repo.
2. **Root directory:** `web` (this is the key setting — Vercel scans the
   entire repo by default).
3. **Framework preset:** Next.js (auto-detected).
4. **Build command + output dir:** leave defaults.
5. **Domain:** add `movvy.ca` and `www.movvy.ca`.

Vercel will give you DNS records to point at — usually:

| Type | Name | Value |
|---|---|---|
| A | `@` (or `movvy.ca`) | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

`next.config.js` already redirects `www.movvy.ca` → `movvy.ca` so the
apex is canonical.

---

## Step 2 — DNS setup at your registrar / Cloudflare

Whichever DNS host you use (Cloudflare, your registrar's panel, etc.):

| Record | Name | Type | Value | Purpose |
|---|---|---|---|---|
| Apex | `movvy.ca` | A | Vercel IP | Website |
| WWW | `www` | CNAME | `cname.vercel-dns.com` | Redirects to apex |
| MX | `movvy.ca` | MX | (from email host) | Receives mail |
| TXT (SPF) | `movvy.ca` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Email auth |
| TXT (DMARC) | `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:management@movvy.ca` | DMARC policy |

The exact MX + SPF records come from whoever hosts your mail. The next
step assumes Cloudflare Email Routing (free).

---

## Step 3 — Cloudflare Email Routing (free aliases)

You said you set up 3 real inboxes:
- `support@movvy.ca`
- `partner@movvy.ca`
- `management@movvy.ca`

The mobile app sends from / mailto's to **more** addresses than that.
Cloudflare Email Routing lets you create unlimited aliases that forward
to one of your 3 real boxes, free.

In Cloudflare dashboard → Email → Email Routing → **Routes**:

| Custom address | Destination |
|---|---|
| `safety@movvy.ca` | `support@movvy.ca` |
| `crew@movvy.ca` | `partner@movvy.ca` |
| `partners@movvy.ca` | `partner@movvy.ca` *(plural alias; the app uses plural)* |
| `receipts@movvy.ca` | `support@movvy.ca` |
| `legal@movvy.ca` | `management@movvy.ca` |
| `dispatch@movvy.ca` | `partner@movvy.ca` |
| `noreply@movvy.ca` | (drop or forward to support) |

While you're there, also enable a **catch-all** that forwards anything
else (`*@movvy.ca`) to `support@movvy.ca` — so a typo in a customer's
support thread doesn't bounce.

Cloudflare auto-adds the MX + SPF records when you enable it.

---

## Step 4 — Resend (transactional email vendor)

The mobile app's edge functions send receipts + invites via Resend.
For real email to send (not the dev-mode console.log fallback), you need:

1. Create an account at [resend.com](https://resend.com).
2. **Add Domain → movvy.ca**.
3. Resend gives you DKIM + return-path CNAMEs — add them at your DNS host.
4. Wait ~5 minutes for verification.
5. Set the API key in Supabase:

   ```bash
   supabase secrets set --project-ref YOUR_PROD_REF \
     RESEND_API_KEY=re_... \
     RESEND_FROM=receipts@movvy.ca
   ```

The edge functions already default `RESEND_FROM` to the right `.ca`
inboxes (`receipts@`, `crew@`, `support@`); you only need to override
the env var if you want a different `from:` per environment.

---

## Step 5 — iOS Universal Links

In `web/public/.well-known/apple-app-site-association` replace
`APPLE_TEAM_ID` with your real Apple Developer Team ID
(10-character string, find it at
[developer.apple.com → Account → Membership](https://developer.apple.com/account#MembershipDetailsCard)).

```bash
sed -i '' 's/APPLE_TEAM_ID/ABCDE12345/g' web/public/.well-known/apple-app-site-association
```

Test:

```bash
curl -sI https://movvy.ca/.well-known/apple-app-site-association
# Content-Type: application/json ← must be this exactly
```

Then on an iPhone with the app installed, tap a link like
`https://movvy.ca/join/TEST-CODE`. iOS opens Movvy directly. If it
opens Safari instead, the AASA file isn't being verified — check the
Content-Type header and that the file is exactly `apple-app-site-association`
with **no extension**.

---

## Step 6 — Android App Links

Generate your app's SHA256 signing-certificate fingerprint:

```bash
# Debug keystore (development build)
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Release keystore (production build) — get it from EAS:
eas credentials -p android
```

Replace `ANDROID_SHA256_FINGERPRINT` in
`web/public/.well-known/assetlinks.json` with the full
`AA:BB:CC:...` string (45 colon-separated hex pairs).

Test once the site is live:

```bash
curl -sI https://movvy.ca/.well-known/assetlinks.json
# Content-Type: application/json
```

Then run the App Links verification:
[Statement List Generator and Tester](https://developers.google.com/digital-asset-links/tools/generator).

---

## Step 7 — Update the App Store / Play Store URLs

Once your app listings exist, swap the placeholders in
`web/components/StoreBadges.tsx` and `web/components/Footer.tsx`:

| Placeholder | Replace with |
|---|---|
| `https://apps.apple.com/ca/app/movvy/idTODO` | The real App Store URL |
| `https://play.google.com/store/apps/details?id=com.movvy.app` | Already correct — bundle ID is `com.movvy.app` |

---

## Step 8 — OG image + favicons

The hero references `/og.png` (1200×630) and `/favicon.ico` (16+32+48).
Drop them in `web/public/`. Until they're added, social previews fall
back to a plain text card — not broken, just less polished.

Cheap path: export from Figma using your brand mark + a 60-character
tagline ("Moving day, sorted in 60 seconds.").

---

## Step 9 — Verify everything works

```bash
# 1. The site loads
curl -sI https://movvy.ca | head -1
# HTTP/2 200

# 2. www redirects to apex
curl -sI https://www.movvy.ca | grep -i location
# location: https://movvy.ca/

# 3. AASA file is JSON
curl -sI https://movvy.ca/.well-known/apple-app-site-association | grep content-type
# Content-Type: application/json

# 4. assetlinks.json is JSON
curl -sI https://movvy.ca/.well-known/assetlinks.json | grep content-type

# 5. Sitemap renders
curl -s https://movvy.ca/sitemap.xml | head -5

# 6. Email aliases route — send a test from your phone:
#    safety@movvy.ca → should land in support@
#    crew@movvy.ca → should land in partner@
#    legal@movvy.ca → should land in management@
```

---

## Where things plug into the mobile app

The mobile app already points to `movvy.ca` for:
- Universal link host (`applinks:movvy.ca` in `app.json`)
- Android intent filter (`host: "movvy.ca"`)
- Every mailto + URL across screens
- Edge function CORS allowlist
- Supabase Auth redirect URLs

When you set the Apple Team ID and Android SHA256, deep links like
`https://movvy.ca/join/CODE` go straight into the app.

---

## Maintenance

The landing site has zero runtime dependencies on the mobile app or
Supabase — it's pure static + SSR. Adding new pages is just a new file
under `web/app/`. Update `app/sitemap.ts` so Google indexes them.
