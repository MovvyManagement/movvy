// =============================================================================
// NotificationBell — reusable header chip that opens the in-app inbox.
//
// Originally lived inline on Home only. Every surface (customer / mover /
// company) shows the same bell + unread badge, so it's one component. The
// `href` prop decides WHICH notifications screen it opens — without it a
// driver tapping the bell would land in /(customer)/notifications and from
// there get routed into customer-only screens. Each surface passes its own
// group's route so the inbox (and its tap-throughs) stay on that surface.
// =============================================================================

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnreadNotificationCount } from '@/lib/data';

type NotificationsHref =
  | '/(customer)/notifications'
  | '/(mover)/notifications'
  | '/(company)/notifications';

export function NotificationBell({
  href = '/(customer)/notifications',
}: {
  href?: NotificationsHref;
}) {
  const { data: unreadCount } = useUnreadNotificationCount();
  const count = unreadCount ?? 0;
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      accessibilityHint="Opens your in-app inbox"
      hitSlop={6}
      className="h-11 w-11 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
    >
      <Ionicons name="notifications-outline" size={20} color="#0A0A0A" />
      {count > 0 ? (
        <View
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-brand-600 items-center justify-center"
          style={{ paddingHorizontal: 4 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Text className="text-[10px] font-bold text-white" maxFontSizeMultiplier={1.2}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
