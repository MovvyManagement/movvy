# Launch runbook — the day you buy the Apple Developer account

Everything below is blocked on **one purchase**: the Apple Developer Program
($99/yr). Nothing else in this list needs code written — the app, the backend,
the push pipeline and the EAS build profiles are already in place. This is the
order to do it in.

> Android is cheaper and unblocked: Google Play Developer is **$25 one-time**.
> If you want to launch somewhere this week, Android can ship first.

---

## 0. What's already done (don't redo these)

- `eas.json` — build profiles (`development`, `development-device`, `staging`,
  `production`) + submit config, all written.
- `app.json` — bundle id `com.movvy.app`, notification icon, associated domain
  `applinks:movvy.ca`, `usesAppleSignIn`, background-location config.
- Push **server** side — `notifications` insert → DB trigger (`0063`) →
  `notifications-push` → Expo Push API. Verified correct; it has simply never
  had a device token to send to.
- In-app banner (`NotificationBannerHost`) — works today, app-open only.

---

## 1. Buy the account

<https://developer.apple.com/programs/enroll/> — $99/yr. As an individual it's
usually approved in minutes; as a company (needs a D-U-N-S number) it can take
days. **Individual is fine to start** and can be migrated later.

## 2. Link the Expo project (writes the missing `projectId`)

```bash
cd /Users/adamhmedat/Desktop/Movvy
npx eas login          # your Expo account
npx eas init           # writes expo.extra.eas.projectId into app.json
```

This is the piece that makes `getExpoPushTokenAsync()` succeed. Right now it
throws (silently — the error is caught and logged), which is why
`device_tokens` is empty and no push has ever been sent.

## 3. Regenerate the native project with the real entitlements

The current `ios/Movvy.entitlements` is deliberately EMPTY — `aps-environment`
(push), Sign in with Apple, and associated-domains are paid-account entitlements
that make **free** signing fail. With a paid account they're valid again:

```bash
npx expo prebuild -p ios --clean
```

Confirm push came back:

```bash
grep -A1 aps-environment ios/Movvy/Movvy.entitlements   # expect: development
```

## 4. First cloud build + TestFlight

```bash
npx eas build -p ios --profile production
```

EAS will offer to create the **APNs key** and distribution certificate — say
yes; it manages them for you (this is what actually delivers the push banners).

```bash
npx eas submit -p ios --latest
```

Then in App Store Connect add testers to TestFlight. No more cable-and-Xcode
cycle, no 7-day expiry.

## 5. Verify push end-to-end

1. Install the TestFlight build, sign in, **accept the notification prompt**.
2. Check a token registered:
   `select platform, created_at from device_tokens;` — expect a row.
3. Send a chat message from the other account.
4. Expect a lock-screen banner. If the row exists but no banner arrives, check
   the `notifications-push` function logs in the Supabase dashboard.

## 6. Flip the launch switches

These are OFF on purpose for testing. Turn them ON before real customers:

```sql
-- Require approved ID / background check before anyone can perform a move
update feature_flags set enabled = true where key = 'verification_gating_enabled';
```

- **Stripe**: confirm `STRIPE_SECRET_KEY` is a **live** key (`sk_live_…`), not
  `sk_test_…`. Test keys move no real money.
- **Twilio**: creds are already set; buy/confirm the number and flip
  `twilio_proxy_enabled` to turn on masked calls, then point the in-app call
  buttons at `proxy-session-create`.

## 7. Android (independent of Apple, $25 one-time)

```bash
npx eas build -p android --profile production
npx eas submit -p android --latest
```

Needs a Play service-account JSON at `./secrets/play-service-account.json`
(referenced by `eas.json`).

---

## Known gaps at launch (deliberate, not bugs)

- **Late-release penalties are recorded, not collected.** They show as −$100 on
  the crew's Earnings and in admin Revenue, but nothing deducts from a payout
  yet — payouts run through Stripe and aren't live. Wire the deduction when
  payouts go live.
- **In-app banners only while the app is open** until step 4 is done.
- **No photo capture during a move** (condition proof) — the single biggest
  liability gap for a moving marketplace. Recommended as the first post-launch
  build.
