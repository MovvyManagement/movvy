const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Packages that src/lib/optionalRequire.ts treats as optional. We resolve
// each one at config-load time using Node's resolver: installed packages
// map to their real entry file, missing ones map to a null stub so Metro
// can still bundle the literal require() call site without "Unable to
// resolve module" errors. optionalRequire returns null for the stub and
// the caller no-ops.
const OPTIONAL_MODULES = [
  '@sentry/react-native',
  'posthog-react-native',
  'expo-updates',
];
const OPTIONAL_STUB = path.resolve(__dirname, 'src/lib/optionalStub.js');

const optionalResolutions = Object.create(null);
for (const name of OPTIONAL_MODULES) {
  try {
    optionalResolutions[name] = require.resolve(name, { paths: [__dirname] });
    console.log(`[metro-config] optional "${name}" -> installed`);
  } catch {
    optionalResolutions[name] = OPTIONAL_STUB;
    console.log(`[metro-config] optional "${name}" -> stubbed (not installed)`);
  }
}

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const stub = optionalResolutions[moduleName];
  if (stub) {
    return { type: 'sourceFile', filePath: stub };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
