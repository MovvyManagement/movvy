// =============================================================================
// /(admin) — Movvy STAFF console. Not a customer surface, not a partner surface.
//
// This layout had no gate of any kind: a bare Tabs with no role check, while
// app/_layout.tsx registers (admin) as a plain Stack.Screen. Any signed-in
// customer or crew member who deep-linked to /(admin)/dashboard got the whole
// operations shell.
//
// RLS did hold — tested with a real non-admin token, every query those screens
// issue came back empty and admin-suspend-user returned "Full admins only" —
// so this was never a data breach. But an ordinary user seeing Movvy's internal
// tooling with zeroed KPIs and dead kill switches is its own problem, and this
// layout was the only thing standing between the self-signup admin escalation
// (fixed in migration 0101) and the console UI. Defence in depth: gate it.
//
// Nothing in the app navigates here — reaching it requires a deliberate deep
// link — so bouncing non-staff straight home costs legitimate users nothing.
// =============================================================================

import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedColors } from '@/lib/theme';
import { useProfile } from '@/lib/data';
import { useAuth, supabaseConfigured } from '@/lib/supabase';

const STAFF_ROLES = ['movvy_admin', 'movvy_support'];

export default function AdminLayout() {
  const palette = useThemedColors();
  const { loading: authLoading, session } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();

  if (supabaseConfigured) {
    // Wait for both the session and the profile before deciding — rendering the
    // console for a frame and then yanking it is worse than a spinner.
    if (authLoading || (session && profileLoading)) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.appBg }}>
          <ActivityIndicator color={palette.brandDeep} />
        </View>
      );
    }
    if (!session) return <Redirect href="/" />;
    // Fail closed: an unknown or missing role is not staff.
    if (!STAFF_ROLES.includes(String((profile as any)?.role ?? ''))) {
      return <Redirect href="/(customer)/(tabs)/home" />;
    }
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.brandDeep,
        tabBarInactiveTintColor: palette.textPlaceholder,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 84,
          paddingTop: 6,
          paddingBottom: 24,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Ionicons name="speedometer" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color, size }) => <Ionicons name="cube" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="users" options={{ title: 'Users', tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="disputes" options={{ title: 'Disputes', tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="support" options={{ title: 'Support', tabBarIcon: ({ color, size }) => <Ionicons name="headset" color={color} size={size - 2} /> }} />
      {/* Feature flags + paid-API budget control — admin-only kill switches. */}
      <Tabs.Screen name="flags" options={{ title: 'Flags', tabBarIcon: ({ color, size }) => <Ionicons name="flag" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" color={color} size={size - 2} /> }} />
    </Tabs>
  );
}
