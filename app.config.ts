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

  return {
    ...config,
    // ExpoConfig requires name + slug; app.json always provides both, but the
    // types don't know that — assert the fallbacks to keep TypeScript happy.
    name: config.name ?? 'Movvy',
    slug: config.slug ?? 'movvy',
    ios: {
      ...config.ios,
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
  };
};
