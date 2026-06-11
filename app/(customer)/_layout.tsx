import React from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useRequireAuth, supabaseConfigured } from '@/lib/supabase';
import { useThemedColors } from '@/lib/theme';

// =============================================================================
// Customer route group — Stack on top of Tabs
//
// The Tabs layout was moved into (tabs)/ so this Stack can host every
// "pushed" customer screen (referrals, support, saved-addresses,
// modify/[id], notifications, welcome-tour, live, book/*). With this
// structure:
//
//   • Pushing from Profile → /(customer)/support is a Stack push, not a
//     tab switch. Tapping back / iOS swipe-back returns to Profile.
//   • The Tabs bar disappears on every pushed screen — pushed screens
//     own the whole canvas + render their own ScreenHeader.
//   • Auth gating runs here once, so every customer screen (tab or
//     pushed) sits behind the same useRequireAuth guard.
// =============================================================================

export default function CustomerStack() {
  const { ready } = useRequireAuth();
  const palette = useThemedColors();

  if (supabaseConfigured && !ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.appBg,
        }}
      >
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Slide-from-right matches the rest of the app + iOS conventions.
        // Each screen already paints its own ScreenHeader with a chevron-
        // back, so we leave the native header off everywhere.
        animation: 'slide_from_right',
        // gestureEnabled is true by default on iOS — every pushed screen
        // (referrals, support, saved-addresses, modify, notifications,
        // welcome-tour) supports edge-swipe back to the tabs.
      }}
    />
  );
}
