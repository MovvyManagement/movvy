// =============================================================================
// AppSplash — 5-second branded loading screen
//
// Renders above every other surface on cold start. The native expo-splash
// image keeps showing until our JS bundle is ready, then we fade in this
// component with "Movvy" wordmark in bold black, hold for the full 5 s,
// fade out and unmount.
//
// Why a JS-level splash on top of the native one:
//   • The Expo native splash can't render text reliably across platforms
//     without rebuilding native code per release.
//   • Holding a moment lets the QueryClient hydrate + Sentry / analytics
//     init complete before the first interactive screen, so the user's
//     first tap actually has wired-up handlers behind it.
//
// Force the always-light look on purpose — black-on-white is the
// brand mark; we don't invert in dark mode.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Platform } from 'react-native';

interface Props {
  /** Total time the splash is visible, including fade-out. Default 5000 ms. */
  durationMs?: number;
  /** Fires once the splash has finished its fade-out. The parent unmounts it. */
  onFinish: () => void;
}

export function AppSplash({ durationMs = 5000, onFinish }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  // Subtle scale on the wordmark so it doesn't look frozen for 5 s.
  const scale = useRef(new Animated.Value(0.96)).current;
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Fade in (300 ms), hold the rest of the time, then fade out (400 ms).
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();

    const exitAt = Math.max(800, durationMs - 400);
    const exitTimer = setTimeout(() => {
      setExiting(true);
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
        easing: Easing.in(Easing.cubic),
      }).start(({ finished }) => {
        if (finished) onFinish();
      });
    }, exitAt);

    return () => clearTimeout(exitTimer);
  }, [durationMs, opacity, scale, onFinish]);

  return (
    <View
      pointerEvents={exiting ? 'none' : 'auto'}
      // Pin above every other surface. The root provider chain renders
      // AppSplash AFTER the route stack so we paint on top without needing
      // an explicit zIndex on every screen.
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9998,
      }}
      // Screen-reader announces the brand once on cold start; after the
      // first reading we hide the rest from the a11y tree so VoiceOver
      // doesn't keep returning to it as the fade plays.
      accessibilityRole="image"
      accessibilityLabel="Movvy"
    >
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Text
          // Locked to all-black + bold + a system font that's always
          // available on iOS/Android. We deliberately don't pull from the
          // Inter font here — Inter loads after the JS bundle, so on the
          // first render of the splash it would fall back to the system
          // font anyway. Hard-coding it avoids the "system font for 300 ms
          // then snap to Inter" flicker.
          allowFontScaling={false}
          style={{
            color: '#000000',
            fontSize: 64,
            fontWeight: '900',
            letterSpacing: -2,
            // iOS gives us the SF Pro family by default; Android picks the
            // OS default ('Roboto' or device override). Both render the
            // word at a comparable weight.
            fontFamily: Platform.select({
              ios: 'System',
              android: 'sans-serif-black',
              default: 'System',
            }),
          }}
        >
          Movvy
        </Text>
      </Animated.View>
    </View>
  );
}
