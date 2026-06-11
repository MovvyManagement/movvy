# Accessibility

Where the app stands on WCAG 2.1 AA + iOS Human Interface guidelines, what's
already covered, and what still needs follow-up.

---

## What's wired today

### Screen reader (VoiceOver / TalkBack)

| Surface | Treatment |
|---|---|
| `Button` (primary, secondary, ghost, danger, dark) | `accessibilityRole="button"`, `accessibilityLabel` from `label`, `accessibilityState` reflects `disabled` + `busy`. Custom hint pass-through. |
| `Card` with `onPress` | `accessibilityRole="button"`, label + hint required when interactive (TypeScript hint, not enforced). |
| `Input` | `accessibilityLabel` falls back to the visible `label` prop. `error` text exposed as `accessibilityRole="alert"`. |
| `ScreenHeader` | Title rendered as `accessibilityRole="header"`. Back button labelled "Go back" with hint "Returns to the previous screen". |
| `Badge` | `accessibilityRole="text"` so VoiceOver reads the label without announcing a button. |
| `Chip` | `accessibilityRole="button"`, `accessibilityState.selected` reflects the visual selected state. |
| `EmptyState` | Wrapped as `accessibilityRole="summary"` with a combined "title. body" label so VoiceOver reads it as one unit. |
| `Toast` | `accessibilityRole="alert"` so toasts are announced as they appear. Tap-to-dismiss labelled. |
| `Skeleton` + `CardSkeleton` | `accessibilityElementsHidden + importantForAccessibility="no"` so loading states don't announce noise. |
| `Avatar` | `accessibilityElementsHidden` — the name is read from the surrounding row instead of double-announced. |

### High-traffic surfaces patched directly

- Customer home **notification bell** → label includes unread count, hint "Opens your in-app inbox".
- Live tracker **SOS pill** → role=button, label "Trigger SOS", hint "Alerts Movvy support and your emergency contact".

### Dynamic Type

A module-level side-effect in [src/lib/textDefaults.ts](src/lib/textDefaults.ts)
caps `Text` and `TextInput` at `maxFontSizeMultiplier: 1.5`. Past that, our
tight icon-aligned layouts start to break. Per-component overrides:

| Component | Cap | Why |
|---|---|---|
| `Button` label | 1.3× | Icon + label sit inside a fixed-height pill |
| `Badge` | 1.2× | Inline chips would break the parent row |
| `Chip` | 1.3× | Same — inline chip row |
| `Avatar` initials | 1.1× | Fixed circle size |
| `ScreenHeader` title / subtitle | 1.4× | Header height is fixed |
| `Toast` body | 1.3× | Lines clamp at 3 |

Anything that didn't get a cap inherits the 1.5× global default.

### Dark mode

- `app.json` → `userInterfaceStyle: "automatic"` so the OS Appearance setting
  is respected.
- `tailwind.config.js` → `darkMode: 'media'`. NativeWind reads
  `useColorScheme` itself; every `dark:bg-...` / `dark:text-...` class
  resolves automatically when the system is in dark mode.
- Canonical dark-mode neutrals in `tailwind.config.js`:
  - `night-{50,100,200,300,400,500,900}` mirrors the `silver` scale
  - `mist-{50…500}` mirrors the `ink/silver` text scale
- Primitives ship dark variants out of the box: `Button`, `Card`, `Input`,
  `ScreenHeader`, `Badge`, `Chip`, `EmptyState`, `Skeleton`, `Avatar`.
- Bottom-tab bars in all four route groups (customer / mover / company /
  admin) pull their colours from `useThemedColors()` so they invert with the
  scheme.
- StatusBar style flips via the same hook in `app/_layout.tsx`.
- 47 screen `SafeAreaView`s + 45 header bands were patched in bulk to add
  `dark:bg-night-900` / `dark:bg-night-100` variants. The remaining inner
  `bg-white` / `bg-silver-50` instances are inside primitives we already
  updated, or in modal sheets which read fine on either scheme.

For a one-off hex value (e.g. `Marker` pin colour on the map, `ActivityIndicator`
tint), use `useThemed(lightHex, darkHex)` from
[src/lib/theme.ts](src/lib/theme.ts).

### iPad / iPhone responsiveness

- `app.json` → `ios.supportsTablet: true` (already on before this pass).
- New [src/lib/useResponsiveLayout.ts](src/lib/useResponsiveLayout.ts):
  - `isTablet` for width ≥ 720 dp (catches every iPad rotation + iPad
    Split View moments wider than 720)
  - `contentMaxWidth` = 560 dp on tablet, undefined on phone
  - `readingMaxWidth` = 640 dp on tablet for body-text screens
  - `isCompact` for the SE-class iPhones (≤ 360 dp wide)
- New [src/components/MaxWidth.tsx](src/components/MaxWidth.tsx) wraps any
  page content; on iPhone it's a no-op `View`, on iPad it centres a 560 dp
  column inside the larger window.
- Applied to: Customer support hub, Customer profile, Booking confirm.

The booking flow / live tracker / dispatch screens are not wrapped because
their map + step views actively want to fill the iPad width (the moving-pin
map looks great spread out).

---

## What's still open

Be honest with the user — there are gaps:

1. **Per-screen icon-only `Pressable`s** — primitives are covered; one-off
   icon buttons inside individual screens still need a pass. Rule of
   thumb: if a `Pressable` contains only an `<Ionicons>` with no `Text`
   child, it needs `accessibilityLabel` + `accessibilityRole="button"`.
   Search:
   ```bash
   grep -rE '<Pressable[^>]*>\s*<Ionicons' app/ src/
   ```
2. **Focus order on long ScrollViews** — VoiceOver reads top-to-bottom by
   default, but our compound rows (avatar + name + badge) sometimes split
   into 3 elements. Wrap with `accessible` + a combined `accessibilityLabel`
   when the visual unit is one logical thing.
3. **Reduced Motion** — `expo-haptics` calls + `Animated.spring` toasts +
   the SOS hold-to-confirm ring animation should respect the system
   "Reduce Motion" setting. Add a `useReducedMotion()` hook later and
   short-circuit them.
4. **Contrast audit on dark palette** — the `night-{300,400}` borders against
   `night-100` cards meet WCAG AA at 4.5:1 by colour-distance math, but a
   real Sim-side run with the iOS Accessibility Inspector would catch any
   surprises in compound text (e.g. white-on-amber warning chips on dark).
5. **iPhone SE landscape** — the booking flow is currently portrait-only
   (`app.json` enforces it). When we open landscape later, the
   `isCompact` branch needs to defer to a 2-column step layout for SE.

---

## Manual QA checklist (per release)

- [ ] Toggle iOS Appearance → Dark in Settings, confirm the app follows
- [ ] Settings → Accessibility → Display & Text Size → Larger Text, slide
      to ~AX2, confirm the booking confirm screen still fits one screen
- [ ] VoiceOver on, swipe through the customer home screen, confirm each
      tile / row reads in order without double-announcing
- [ ] iPad mini portrait + landscape: support hub stays centred at 560 dp
- [ ] iPad Pro 12.9" portrait: confirm booking flow doesn't look stretched
- [ ] iPhone SE: home screen "Continue Booking Move" CTA visible without
      scrolling, tab bar labels readable
