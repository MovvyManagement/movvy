import { ExpoConfig, ConfigContext } from 'expo/config';

// =============================================================================
// Thin overlay on top of app.json.
//
// Expo evaluates app.config.ts LAST, passing the fully-parsed app.json in as
// `config`. We spread it unchanged and inject one thing: the Google Maps SDK
// key for the native map (react-native-maps with provider={PROVIDER_GOOGLE}).
//
// WHY IT LIVES HERE, NOT IN app.json: this is a CLIENT key that gets baked into
// the native binary (Info.plist on iOS, AndroidManifest on Android). Keeping it
// in the environment means it's never committed, and it can be swapped per build
// without editing tracked files.
//
// This is the MOBILE key — DISTINCT from GOOGLE_MAPS_SERVER_KEY (the server-side
// key the edge functions use for autocomplete / place-details / routes). Create
// it in Google Cloud with "Maps SDK for iOS" + "Maps SDK for Android" enabled,
// then RESTRICT it:
//   • iOS:     application restriction = iOS bundle id  com.movvy.app
//   • Android: application restriction = package com.movvy.app + signing SHA-1
// and set it in .env.local (gitignored) as:
//   GOOGLE_MAPS_MOBILE_KEY=AIza...
// Expo loads .env files into process.env when evaluating this config, so the
// next `expo prebuild` / native build bakes it in. Without it, iOS maps render
// blank (Android too, since it also needs a key) — the app still runs.
// =============================================================================

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.GOOGLE_MAPS_MOBILE_KEY ?? '';

  // Local "unsigned" escape hatch. Apple's free Personal teams can't sign an app
  // that declares Push Notifications (aps-environment) or Associated Domains.
  // Set EXPO_UNSIGNED_LOCAL=1 for a throwaway on-device dev build (e.g. to
  // preview the icon/splash) and we drop those two capabilities so a personal
  // team can sign. NEVER set it for TestFlight / App Store / EAS — production
  // keeps push + universal links because the env var is unset there.
  const freeSigning = process.env.EXPO_UNSIGNED_LOCAL === '1';

  return {
    ...config,
    // ExpoConfig requires name + slug; app.json always provides both, but the
    // types don't know that — assert the fallbacks to keep TypeScript happy.
    name: config.name ?? 'Movvy',
    slug: config.slug ?? 'movvy',
    ios: {
      ...config.ios,
      // Drop Associated Domains for the local unsigned build. `undefined`
      // removes the com.apple.developer.associated-domains entitlement.
      ...(freeSigning ? { associatedDomains: undefined } : {}),
      config: {
        ...config.ios?.config,
        ...(mapsKey ? { googleMapsApiKey: mapsKey } : {}),
      },
    },
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        ...(mapsKey ? { googleMaps: { apiKey: mapsKey } } : {}),
      },
    },
    // expo-notifications injects the aps-environment (Push) entitlement, which a
    // personal team can't sign — strip the plugin for the local unsigned build.
    plugins: freeSigning
      ? (config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-notifications')
      : config.plugins,
  };
};
