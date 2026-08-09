import '../global.css';
// Side-effect: clamp Text / TextInput maxFontSizeMultiplier so iOS Dynamic
// Type can scale, but never enough to break our tight icon-aligned layouts.
import '@/lib/textDefaults';
// Lock NativeWind to light mode regardless of the OS Appearance setting.
// NativeWind v4 has its own runtime color-scheme observer that ignores the
// `darkMode: 'class'` flag in tailwind.config.js — calling colorScheme.set()
// here is the only way to actually pin every `dark:` variant to off until
// dark-mode coverage is complete across every screen.
import { colorScheme } from 'nativewind';
colorScheme.set('light');
// Register the background live-location TaskManager task at startup (side-effect
// import) so iOS/Android can deliver location updates to it while the app is
// backgrounded during a move.
import '@/lib/bgTracking';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/supabase';
import { StripeProvider } from '@stripe/stripe-react-native';

// Publishable key is safe to ship in the client (it's public by design). If
// unset, StripeProvider renders harmlessly and the pay button no-ops.
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
import { queryClient, useAutoRegisterPushToken } from '@/lib/data';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { track } from '@/lib/analytics';
import { initSentry } from '@/lib/sentry';
import { useEffect, useState } from 'react';
import { useThemeScheme, themedColors } from '@/lib/theme';
import { AppSplash } from '@/components/AppSplash';
import { NotificationBannerHost } from '@/components/NotificationBannerHost';
import * as SplashScreen from 'expo-splash-screen';

// Init Sentry as a module-level side effect so it's up before any
// component renders. No-op if EXPO_PUBLIC_SENTRY_DSN isn't set.
initSentry();

// Keep the native Expo splash visible until our JS-level AppSplash mounts.
// preventAutoHideAsync is safe to call multiple times — it no-ops after
// the first invocation.
SplashScreen.preventAutoHideAsync().catch(() => {});

function PushTokenWatcher() {
  useAutoRegisterPushToken();
  return null;
}

/** Fires app_open exactly once per cold start — top of the funnel. */
function AnalyticsBootstrap() {
  useEffect(() => {
    track('app_open');
  }, []);
  return null;
}

export default function RootLayout() {
  // Track the OS Appearance setting so the root container + status bar
  // switch with it. We do NOT manually toggle a 'dark' class because the
  // tailwind config is darkMode='media' — NativeWind reads useColorScheme
  // itself and routes `dark:` variants automatically.
  const scheme = useThemeScheme();
  const palette = themedColors[scheme];

  // 5-second branded splash: stays mounted on cold start; the moment we
  // render it, we tell the native Expo splash to fade out underneath, so
  // there's no white-flash gap between native splash and our JS splash.
  // When AppSplash finishes its own fade-out (~5 s), it calls onFinish
  // and we unmount it — the route stack underneath is fully painted by
  // that point.
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => {
    // Hide the native splash once the JS bundle has rendered the first
    // frame — at this point AppSplash is already painting over it.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    // ErrorBoundary is the outermost wrapper — anything in providers, the
    // nav stack, or screens that throws during render gets caught here
    // and shown as a friendly "Something went wrong" screen instead of a
    // white-screen crash.
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.appBg }}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ToastProvider>
              <AuthProvider>
                {/* No merchantIdentifier: that prop exists only to enable
                    Apple Pay, and setting it makes the build ask for the
                    in-app-payments entitlement. Movvy takes cards — see
                    usePayForMove. */}
                <StripeProvider
                  publishableKey={STRIPE_PUBLISHABLE_KEY}
                  urlScheme="movvy"
                >
                <>
                <PushTokenWatcher />
                <NotificationBannerHost />
                <AnalyticsBootstrap />
                <StatusBar style={palette.statusBar} />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.appBg },
                    animation: 'slide_from_right',
                  }}
                >
                  {/* Once the user has signed in we don't want them to be
                      able to iOS-edge-swipe back to /index or /(auth)/login.
                      router.replace already removes those screens from the
                      stack — disabling the gesture is the belt that catches
                      the case where a stale history entry leaks through.
                      To exit a portal the user has to sign out, which calls
                      router.replace('/') and intentionally lands them on
                      the welcome screen. */}
                  <Stack.Screen name="(customer)" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="(mover)" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="(company)" options={{ gestureEnabled: false }} />
                  <Stack.Screen name="(admin)" options={{ gestureEnabled: false }} />
                </Stack>
                {/* JS-level branded splash. Sits above the route stack so the
                    first interactive screen is fully mounted and ready by the
                    time the splash fades out. */}
                {!splashDone ? (
                  <AppSplash onFinish={() => setSplashDone(true)} />
                ) : null}
                </>
                </StripeProvider>
              </AuthProvider>
            </ToastProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
