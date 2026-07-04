import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MovvyMark } from '@/components/MovvyMark';
import { useActiveBooking } from '@/lib/data';
import { useThemedColors } from '@/lib/theme';

// =============================================================================
// Customer bottom-nav layout — EXACTLY three tabs.
//
// Only home / bookings / profile live in this folder, so the Tabs
// component literally cannot render anything else in the bar. Every other
// customer screen (referrals, support, saved-addresses, modify/[id],
// notifications, welcome-tour, live, book/*) sits one level up under the
// parent (customer)/_layout.tsx Stack. router.push to any of those screens
// puts them on top of the Tabs, so the back button + iOS swipe-back
// returns to whichever tab the user came from — instead of switching
// tabs and dropping them on Home.
//
// Auth gating + Supabase-ready check live on the parent Stack so this file
// stays focused on the tab bar.
// =============================================================================

export default function CustomerTabs() {
  const palette = useThemedColors();

  // Green dot on the Moves tab when a live move is in progress so the user
  // can spot it instantly — that's where chat + tracking now live.
  const { data: active } = useActiveBooking();
  const movesBadge = active ? '·' : undefined;

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
        // Equal-width tab items + centred icon/label so the three visible
        // tabs are evenly distributed across the bar.
        tabBarItemStyle: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Moves',
          // Full-color brand mark in the tab bar (truck + pin SVG). Active /
          // inactive state still reads via the label color underneath.
          tabBarIcon: ({ size }) => <MovvyMark size={size - 2} />,
          tabBarBadge: movesBadge,
          tabBarBadgeStyle: { backgroundColor: '#16A34A', minWidth: 12, height: 12, fontSize: 10 },
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
