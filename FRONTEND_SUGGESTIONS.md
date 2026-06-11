# Frontend suggestions

Categorized, prioritized list of UX/feature improvements I'd recommend for
Movvy. Grouped by impact-to-effort. Pick anything from this list and I'll
build it.

Legend: 🟢 high impact · 🟡 medium · 🔵 nice-to-have · ⚙️ effort estimate (S/M/L)

---

## 1 · Trust & conversion (book-rate boosters)

Things that make a first-time visitor more likely to convert.

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 1.1 | **Trust strip on welcome screen** — small row of stats (4.9★ · 1,200+ moves · CA-insured · Background-checked drivers). You partly have this; make it more prominent. | 🟢 | S |
| 1.2 | **Verified-mover badge** on driver card during tracking — green checkmark with hover "Background checked + insured". | 🟢 | S |
| 1.3 | **First-time customer onboarding tour** — 3-screen swipe-through after signup explaining the 5 driver flags + tracking + payment. Reduce confusion at first booking. | 🟢 | M |
| 1.4 | **Instant price preview** on the home screen — once both addresses are picked, show "Estimated from $X" before they tap Book. Sticker shock prevention. | 🟢 | S |
| 1.5 | **Pickup-only mode for small jobs** — "Just need a small move?" CTA on home shortcut to single-items flow. | 🟡 | S |
| 1.6 | **Photo gallery of past Movvy crews** — small carousel on welcome screen showing real (anonymized) mover photos. | 🔵 | M |
| 1.7 | **Live "X moves happening now in Alberta" counter** — fake-it-til-you-make-it social proof. | 🔵 | S |

## 2 · Booking-flow polish

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 2.1 | **Photo upload that actually works** — wire the camera/video buttons in the Details step to expo-image-picker, upload via the existing `documents-upload-url` edge fn pattern, render thumbnails. The UI is there; the backend's ready; just connect the dots. | 🟢 | M |
| 2.2 | **Step-back warning** — if user is on step 4 and taps back, show "Discard changes?" sheet. Currently they lose state silently. | 🟡 | S |
| 2.3 | **Smarter time-window suggestions** — pre-select the next available slot instead of an arbitrary 9-11 AM. Show "Most popular: 10 AM-12 PM" tag. | 🟡 | S |
| 2.4 | **Promo code field** with live validation — type code → green checkmark + "$25 off" preview as they type. (Server-side `promo-validate` edge fn is built; UI is missing.) | 🟢 | S |
| 2.5 | **Estimate impact widget on Details step** — as user toggles packing/insurance/heavy items, show the running total change in real-time ("+$120 packing") instead of waiting until step 5. | 🟢 | M |
| 2.6 | **Map preview that confirms address** — when they pick an address, animate a pin drop on the live map (you have this; reinforce with subtle haptic). | 🔵 | S |
| 2.7 | **Saved-address chips** — show home/work as chips above the address input (after they've saved them via the addresses screen). Tap → autofill. | 🟢 | S |
| 2.8 | **Multi-stop hint** — small "Add a stop" link below the drop-off address (disabled in MVP with "Coming soon · multi-stop moves"). Sets the expectation. | 🔵 | S |

## 3 · Live tracking experience

The most-watched screen during a job. Polish here = repeat customers.

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 3.1 | **Animated driver pin** that smoothly interpolates between GPS pings instead of jumping. Use `react-native-reanimated`. | 🟢 | M |
| 3.2 | **Status pulse** — when driver flags a new step, briefly pulse the relevant status row in the timeline + haptic feedback. | 🟢 | S |
| 3.3 | **"Driver arriving soon" full-screen alert** — when ETA drops below 5 minutes, push a clear modal so customer can prep. | 🟢 | S |
| 3.4 | **Crew photos in the driver card** — show the actual photos of the assigned movers (already have storage; just need to wire). | 🟡 | M |
| 3.5 | **Live count of completed steps** — "Step 3 of 5 complete" with progress bar instead of just the timeline. Easier glance. | 🟡 | S |
| 3.6 | **Share-trip button** — Uber-style. Customer can text a link to family so they can see the same live map. (Public read-only URL with short-lived token.) | 🟢 | M |
| 3.7 | **Safety check-in for long moves** — every 90 min of in_transit, prompt customer "Everything OK? Tap to confirm or open chat." | 🔵 | M |
| 3.8 | **Live photo updates from crew** — driver can snap "your couch is loaded safely" photos; customer sees them inline in the timeline. | 🟡 | L |

## 4 · Driver/partner side

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 4.1 | **Job notification sound + push** when a new job lands in the feed. They currently have to manually pull-to-refresh. (Push tokens registered ✓; just need the send side wired.) | 🟢 | S |
| 4.2 | **Earnings widget on Jobs screen** — top bar shows "Today: $612 · Week: $3,210". Already in `mockEarnings`; wire to real data. | 🟢 | S |
| 4.3 | **Accept with one tap** — currently they navigate to job detail → tap Accept. Add an Accept button right on the feed card with a confirmation sheet. | 🟢 | S |
| 4.4 | **Navigation hand-off button** — "Open in Apple Maps" / "Open in Google Maps" on the active job screen. One tap → native turn-by-turn. | 🟢 | S |
| 4.5 | **Pre-move checklist** — when status is `arrived`, show a checklist (truck inspected, customer met, walk-through done) the driver ticks before pressing "Start loading". | 🟡 | M |
| 4.6 | **Damage report flow** — driver can take photos + add notes if anything happens. Gets attached to the booking for dispute defense. | 🟢 | M |
| 4.7 | **Weekly earnings summary** sent every Monday via push + email — "$3,210 last week · 22 jobs · 4.9★". | 🟡 | S |
| 4.8 | **Rating prompt for customer** at end of job — currently driver doesn't rate the customer. Add a quick 5-star pop-up after `completed`. | 🟢 | S |
| 4.9 | **Cancel-with-reason picker** — instead of plain text, give partners a chip-select for common reasons (truck broke down, traffic, illness). Better data for ops. | 🟡 | S |

## 5 · Payments & receipts UX (when Stripe lands)

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 5.1 | **Apple Pay / Google Pay as the default** — way higher conversion than typing a card. | 🟢 | M |
| 5.2 | **Save-card-for-faster-future** opt-in. | 🟢 | S |
| 5.3 | **Itemized receipt PDF** auto-emailed after each completed move. | 🟢 | M |
| 5.4 | **Tip preset buttons relative to total**, not flat amounts. Currently $5/$10/$20/$30; better: 15%/20%/25%/other. People tip more with %. | 🟢 | S |
| 5.5 | **Split-pay between roommates** — invite a second card to cover half. | 🔵 | L |
| 5.6 | **Pre-authorized hold UX** — clearly explain "$X held now, charged after the move" with a tooltip. | 🟡 | S |

## 6 · Engagement & retention

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 6.1 | **"Move again" button** on completed bookings — pre-fills addresses + details for a repeat customer. One-tap re-book. | 🟢 | S |
| 6.2 | **Referral program** — share your code, you + friend get $25 off each. Track via promo_codes table. | 🟢 | M |
| 6.3 | **Add-to-calendar** after booking confirms — generates a .ics with the move window. | 🟡 | S |
| 6.4 | **Seasonal nudges** — push notification "End of month? Movvy crews still available." Sent on month-end if no recent booking. | 🟡 | S |
| 6.5 | **Movvy credits** earned for referrals, ratings, repeat bookings. Builds loyalty. | 🔵 | L |
| 6.6 | **Birthday discount** — automatic promo code 7 days before customer's birthday. | 🔵 | S |

## 7 · Empty states & loading polish

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 7.1 | **Skeleton loaders everywhere** instead of spinners on screens with predictable layouts (booking list, dashboard). Feels 2× faster. | 🟢 | M |
| 7.2 | **Better empty states with illustrations** — "No moves yet" with a friendly drawing instead of an icon. | 🟡 | M |
| 7.3 | **Pull-to-refresh on every scroll view** — most already have it; audit and fill gaps. | 🟡 | S |
| 7.4 | **Optimistic UI** for status updates — driver taps "Arrived", UI updates immediately, backend confirms in background. Already use TanStack Query — just enable mutations. | 🟢 | S |
| 7.5 | **Network error handling** — instead of generic alerts, show a small banner "Reconnecting…" when offline; queue mutations. | 🟡 | L |

## 8 · Profile + account

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 8.1 | **Profile-completion progress** — show "75% complete" with a CTA to add the missing piece (photo / phone / saved address). | 🟡 | S |
| 8.2 | **Profile photo upload** — currently just shows initials. Wire to the `profile-photos` Storage bucket (RLS already done). | 🟢 | S |
| 8.3 | **Saved-addresses CRUD screen** — list, add, edit, delete, set default. Hooks already built (`useSavedAddresses`), just need a screen. | 🟢 | M |
| 8.4 | **Payment methods screen** — list cards, set default, remove. (Needs Stripe.) | 🟡 | M |
| 8.5 | **Email/phone change with re-verify** — currently no way to change contact info after signup. | 🟢 | M |
| 8.6 | **Account deletion** — required by App Store / Play Store for any app with auth. Soft delete via `profiles.deleted_at`. | 🟢 | M |

## 9 · Accessibility & inclusivity

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 9.1 | **VoiceOver / TalkBack labels** on every icon button. Currently most icons have no `accessibilityLabel` → blind users see "Button". | 🟢 | M |
| 9.2 | **Dynamic font scaling** — respect iOS system font size. Most screens won't scale right now. | 🟡 | M |
| 9.3 | **French (Québec-French + Canadian-French) localization** — when you expand outside Alberta this matters. Use `i18next`. | 🔵 | L |
| 9.4 | **Reduced motion support** — disable the animated map pin + status pulses if user has "Reduce Motion" enabled. | 🔵 | S |
| 9.5 | **Larger tap targets** — audit; some icon-only buttons are 32×32 which is below Apple's 44pt min. | 🟡 | S |

## 10 · Admin / ops dashboard

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 10.1 | **Real-time live moves map** — Mapbox/Apple Maps showing every active booking pin in Calgary + Edmonton, color-coded by status. | 🟢 | L |
| 10.2 | **One-click partner approve from email** — verification email to admin with embedded approve/reject deep links. | 🟢 | M |
| 10.3 | **Daily ops digest** — every morning email with yesterday's metrics: bookings, revenue, completion rate, open disputes, API spend. | 🟡 | M |
| 10.4 | **Booking detail page with full timeline** — every status change + audit log entry + chat preview, all in one screen. | 🟢 | M |
| 10.5 | **Manual booking-search broadcast button** — re-fanout to partners if first round had no acceptors. | 🟡 | S |
| 10.6 | **Web admin dashboard at admin.movvy.app** — deploy the existing screens as a web app. Faster than mobile for ops. | 🟢 | M |

## 11 · Performance

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 11.1 | **Lazy-load route groups** — booking flow, admin screens currently bundled with home. Splitting saves first-load time. | 🟡 | M |
| 11.2 | **Image-pick + compress** — when partners upload docs/photos, compress to 1600px / 80% before upload. Reduce Storage costs. | 🟢 | S |
| 11.3 | **Realtime-subscription cleanup** — verify every subscription unsubscribes on unmount (already mostly done; audit `useLiveTracking` and `useThreadMessages`). | 🟡 | S |
| 11.4 | **Cache booking list with React Query persistor** — survive app cold-start with instant UI from cache, then refresh. | 🔵 | M |

## 12 · Mobile-native polish

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 12.1 | **Haptic feedback** — `expo-haptics` on every primary CTA (Book, Accept, Confirm). Free perceived-quality win. | 🟡 | S |
| 12.2 | **App icon + splash screen** — currently default Expo placeholders. Get a designer or AI-gen with brand colors. | 🟢 | S |
| 12.3 | **Notification badges on tab icons** — show unread count on Moves tab when there's an active move. | 🟢 | S |
| 12.4 | **Dark mode** — UI already mostly works because of palette; add explicit dark variants for cards/borders. | 🔵 | M |
| 12.5 | **Universal links** — `movvy.app/booking/MV-2032` opens the app directly to that tracking screen. | 🟡 | M |

## 13 · Marketing & growth surface area

| # | Idea | Impact | ⚙️ |
|---|---|---|---|
| 13.1 | **Public landing page at movvy.app** — Next.js or just static. Showcases the app, App Store badges, hero map. | 🟢 | M |
| 13.2 | **Pre-launch signup waitlist** for cities not yet active — "Notify me when Movvy launches in Lethbridge". Builds demand signal. | 🔵 | M |
| 13.3 | **Blog/help center** for SEO ("how to pack a kitchen for a move"). | 🔵 | M |
| 13.4 | **App Store / Play Store listing** — screenshots, feature graphic, video preview. Critical for conversion from search. | 🟢 | M |

---

## Recommended order if I were you

If I were prioritizing one sprint of polish, I'd do these in order:

1. **2.1** — wire photo upload (you have everything ready; just connect)
2. **3.6** — share-trip link (huge moat vs competitors)
3. **2.4** — promo code field with live validation
4. **6.1** — "Move again" one-tap re-book
5. **4.3** + **4.4** — driver one-tap accept + native maps hand-off
6. **8.6** — account deletion (App Store requires it)
7. **12.1** + **12.2** — haptics + app icon
8. **10.6** — deploy web admin (you'll need this for ops as soon as you have real customers)

Hit me up on any of these — say `do #4.3` or `bundle 2.1 + 2.4 + 6.1` and I'll start building.
