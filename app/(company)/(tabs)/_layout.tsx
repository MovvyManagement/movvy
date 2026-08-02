import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemedColors } from '@/lib/theme';

// =============================================================================
// Company bottom-nav — exactly 4 tabs.
//
// Dashboard · Jobs · Earnings · Company
//
// Anything that isn't one of these four lives in app/(company)/<route>.tsx
// (drivers, trucks, invoices, safety, onboarding, dispatch redirect) and
// gets pushed onto the parent Stack — so iOS edge-swipe / chevron-back
// returns to whichever tab the user came from instead of landing on the
// Dashboard.
// =============================================================================

export default function CompanyTabs() {
  const palette = useThemedColors();

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
        tabBarItemStyle: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase" color={color} size={size - 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Crew',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size - 2} />,
        }}
      />
    </Tabs>
  );
}
