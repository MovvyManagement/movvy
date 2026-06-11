import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemedColors } from '@/lib/theme';

// =============================================================================
// Driver bottom-nav — 5 tabs.
//
// Dashboard · Jobs · Active · Earnings · Profile
//
// "Active" is a first-class tab (not a pushed stack screen) so a driver who
// accepts a move can freely jump to Earnings, the open feed, etc. and come
// straight back — the move never traps them on a back-button-less screen.
// When there's no live move the tab just shows an empty state.
//
// Anything that isn't one of these five lives in app/(mover)/<route>.tsx
// (job/[id], availability, referrals, navigate, onboarding, notifications)
// and gets pushed onto the parent Stack — so iOS edge-swipe / chevron-back
// returns to whichever tab the driver came from instead of landing on the
// Dashboard.
// =============================================================================

export default function MoverTabs() {
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
        name="active"
        options={{
          title: 'Active',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="navigate-circle" color={color} size={size} />
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
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" color={color} size={size + 2} />
          ),
        }}
      />
    </Tabs>
  );
}
