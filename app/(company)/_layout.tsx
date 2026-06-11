import React from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useRequireAuth, supabaseConfigured } from '@/lib/supabase';
import { useThemedColors } from '@/lib/theme';

// =============================================================================
// Company route group — Stack on top of Tabs (mirrors the customer pattern).
//
// The bottom Tabs (Dashboard · Jobs · Earnings · Company) live in (tabs)/.
// Every "pushed" company screen (drivers, trucks, invoices, safety, edit
// modals' parent routes, onboarding) sits at this Stack level. That means
// router.push to one of them is a real Stack push, not a tab switch — so
// back / iOS edge-swipe returns to the tab the user came from instead of
// landing on the Dashboard.
// =============================================================================

export default function CompanyStack() {
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
        animation: 'slide_from_right',
      }}
    />
  );
}
