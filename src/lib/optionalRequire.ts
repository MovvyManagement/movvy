// =============================================================================
// optionalRequire — load a module by name, returning null if it isn't installed
//
// Metro bundles modules by static `require('literal-string')` analysis and
// replaces each call with `__r(numericId)` at bundle time. The runtime
// `require` polyfill only accepts numeric IDs, so any attempt to call
// `require(variable)` throws "Invalid call at line X: require(name)" — there
// is no Node-style runtime require to fall through to. Aliasing the binding
// (`const r = require; r(name)`) doesn't help.
//
// So we keep an explicit map of literal `require()` calls — one per package
// we want to treat as optional. Metro can statically resolve each one.
// Packages that aren't installed are handled by the resolver hook in
// metro.config.js, which redirects unresolved optional modules to
// `src/lib/optionalStub.js` (which exports null). That keeps the bundle
// building when the package isn't in node_modules.
//
// To add a new optional package:
//   1. add it to OPTIONAL_LOADERS below
//   2. add it to OPTIONAL_MODULES in metro.config.js
// =============================================================================

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const OPTIONAL_LOADERS: Record<string, () => unknown> = {
  '@sentry/react-native': () => require('@sentry/react-native'),
  'posthog-react-native': () => require('posthog-react-native'),
  'expo-updates': () => require('expo-updates'),
};
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

export function optionalRequire<T = unknown>(name: string): T | null {
  const loader = OPTIONAL_LOADERS[name];
  if (!loader) {
    if (__DEV__) {
      console.warn(
        `[optionalRequire] "${name}" is not registered. Add it to OPTIONAL_LOADERS in src/lib/optionalRequire.ts and OPTIONAL_MODULES in metro.config.js.`,
      );
    }
    return null;
  }
  try {
    const mod = loader();
    return (mod ?? null) as T | null;
  } catch {
    return null;
  }
}
