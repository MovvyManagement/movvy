// =============================================================================
// Theme helper — single source of truth for "am I in dark mode right now?"
//
// We use NativeWind's `dark:` variants for most colour decisions. This hook
// is for the edge cases that can't use class names:
//   • <StatusBar> style                          (light vs dark icon glyphs)
//   • Pin colours passed to <Marker> on the map  (string-typed props)
//   • Activity indicators / hex-coloured icons   (so they don't vanish on
//                                                 dark bg)
//
// We deliberately track the OS Appearance setting rather than building a
// per-user override. Adding one is straightforward later — wrap this in a
// context that can override the system value.
// =============================================================================

export type ThemeScheme = 'light' | 'dark';

// Movvy is locked to light mode app-wide while dark-mode coverage is
// incomplete (most screens hard-code bg-white with no dark: variant).
// Returning 'light' unconditionally keeps the StatusBar, root container
// bg, and any palette consumer on the brand white/silver/green palette
// regardless of the OS Appearance setting. Re-introduce useColorScheme()
// here once tailwind.config.js flips back to darkMode: 'media' and every
// screen has dark: variants.
export function useThemeScheme(): ThemeScheme {
  return 'light';
}

/** Boolean shortcut. */
export function useIsDark(): boolean {
  return useThemeScheme() === 'dark';
}

/** Pick a value based on the current scheme. Useful for one-off colours. */
export function useThemed<T>(light: T, dark: T): T {
  return useIsDark() ? dark : light;
}

// ─── Canonical palette ─────────────────────────────────────────────────────
// Token names mirror NativeWind classes so we can swap from inline hex
// to className anytime. Keep these in sync with tailwind.config.js.

export const themedColors = {
  light: {
    // surfaces
    appBg: '#FAFAFA',          // silver-50
    surface: '#FFFFFF',         // white
    surfaceMuted: '#F4F4F5',    // silver-100
    border: '#E4E4E7',          // silver-200
    // ink
    text: '#0A0A0A',
    textMuted: '#52525B',
    textPlaceholder: '#A1A1AA',
    // brand
    brand: '#16A34A',
    brandDeep: '#047857',
    // status bar
    statusBar: 'dark' as const,
  },
  dark: {
    appBg: '#0B0B0E',
    surface: '#1C1C1E',
    surfaceMuted: '#27272A',
    border: '#33333A',
    text: '#FAFAFA',
    textMuted: '#A1A1AA',
    textPlaceholder: '#71717A',
    brand: '#34D399',           // brighter green so it reads on near-black
    brandDeep: '#10B981',
    statusBar: 'light' as const,
  },
};

/** Hook that returns the active palette as plain object — for hex callers. */
export function useThemedColors() {
  const scheme = useThemeScheme();
  return themedColors[scheme];
}
