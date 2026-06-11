import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemedColors } from '@/lib/theme';

export default function AdminLayout() {
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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Ionicons name="speedometer" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color, size }) => <Ionicons name="cube" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="users" options={{ title: 'Users', tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="disputes" options={{ title: 'Disputes', tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle" color={color} size={size - 2} /> }} />
      {/* Feature flags + paid-API budget control — admin-only kill switches. */}
      <Tabs.Screen name="flags" options={{ title: 'Flags', tabBarIcon: ({ color, size }) => <Ionicons name="flag" color={color} size={size - 2} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" color={color} size={size - 2} /> }} />
    </Tabs>
  );
}
