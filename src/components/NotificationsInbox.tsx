// =============================================================================
// NotificationsInbox — shared in-app inbox, rendered by all three surfaces.
//
// The list UI (rows, unread badge, mark-all-read, skeletons, empty state) is
// identical for customers, movers and companies — they all read the same
// per-profile `notifications` table. The ONLY thing that differs is where a
// tapped row deep-links to, so that a driver never gets dropped into a
// customer screen (and vice-versa). That routing is driven by `surface`:
//
//   customer → booking/move rows open /(customer)/bookings,
//              promo/credit/referral rows open /(customer)/referrals
//   mover    → job/booking rows open /(mover)/jobs,
//              promo/credit/referral rows open /(mover)/referrals
//   company  → job/booking rows open /(company)/jobs
//              (companies have no referrals surface, so those stay put)
// =============================================================================

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type AppNotification,
} from '@/lib/data';
import { fmtTime, fmtDateShort } from '@/lib/format';

export type NotificationSurface = 'customer' | 'mover' | 'company';

export function NotificationsInbox({ surface }: { surface: NotificationSurface }) {
  const { data: items, isLoading, refetch, isRefetching } = useNotifications(50);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unreadCount = (items ?? []).filter((n) => !n.read_at).length;

  const onTap = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.id);

    const cat = n.category ?? '';
    const isReferral =
      cat.includes('promo') ||
      cat.includes('credit') ||
      cat.includes('referral') ||
      cat.includes('gift');
    // Booking- and job-related notifications: status transitions written by the
    // bookings_notify_status trigger ('booking.*') plus the partner-facing
    // 'job.available' broadcast. Keep the keyword list loose so unknown
    // categories that still carry a booking_id route sensibly.
    const isBookingLike =
      !!n.data?.booking_id ||
      cat.includes('booking') ||
      cat.includes('move') ||
      cat.includes('job') ||
      ['assigned', 'confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit',
       'unloading', 'completed', 'cancelled', 'review', 'available']
        .some((k) => cat.includes(k));

    if (surface === 'customer') {
      if (isReferral) return void router.push('/(customer)/referrals');
      if (isBookingLike) router.push('/(customer)/bookings');
      return;
    }
    if (surface === 'mover') {
      if (isReferral) return void router.push('/(mover)/referrals');
      if (isBookingLike) router.push('/(mover)/jobs');
      return;
    }
    // company — no referrals surface; route job/booking activity to the feed
    if (isBookingLike) router.push('/(company)/jobs');
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          right={
            unreadCount > 0 ? (
              <Pressable
                onPress={() => markAll.mutate()}
                hitSlop={6}
                disabled={markAll.isPending}
              >
                <Text className="text-xs font-semibold text-brand-700">
                  Mark all read
                </Text>
              </Pressable>
            ) : null
          }
        />
      </View>

      {isLoading && !items ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <CardSkeleton count={4} />
        </ScrollView>
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="No notifications yet"
          body="Booking confirmations, status alerts, and move completion notices will show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor="#16A34A"
            />
          }
        >
          {items.map((n) => (
            <NotificationRow key={n.id} item={n} onPress={() => onTap(n)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: () => void;
}) {
  const unread = !item.read_at;
  const icon = iconForCategory(item.category);
  return (
    <Pressable
      onPress={onPress}
      className={`mb-2 rounded-2xl p-4 flex-row active:opacity-80 ${
        unread ? 'bg-white border border-brand-100' : 'bg-white'
      }`}
    >
      <View
        className={`h-10 w-10 rounded-2xl items-center justify-center ${
          unread ? 'bg-brand-50' : 'bg-silver-100'
        }`}
      >
        <Ionicons name={icon} size={18} color={unread ? '#047857' : '#71717A'} />
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text className={`text-sm font-bold ${unread ? 'text-ink-900' : 'text-ink-700'}`}>
            {item.title}
          </Text>
          {unread ? (
            <View className="h-2 w-2 rounded-full bg-brand-600 ml-2" />
          ) : null}
        </View>
        <Text className="mt-0.5 text-xs text-silver-600 leading-5" numberOfLines={3}>
          {item.body}
        </Text>
        <Text className="mt-1 text-[10px] text-silver-400">
          {relativeTime(item.created_at)}
        </Text>
      </View>
    </Pressable>
  );
}

// Map notification category → icon. Keep loose so unknown categories fall
// through to a neutral default.
function iconForCategory(category: string): keyof typeof Ionicons.glyphMap {
  if (category.includes('on_the_way')) return 'car-sport';
  if (category.includes('arrived')) return 'flag';
  if (category.includes('loading')) return 'cube';
  if (category.includes('in_transit')) return 'navigate-circle';
  if (category.includes('unloading')) return 'cube-outline';
  if (category.includes('completed')) return 'checkmark-circle';
  if (category.includes('assigned') || category.includes('confirmed')) return 'people-circle';
  if (category.includes('available')) return 'briefcase';
  if (category.includes('cancel')) return 'close-circle';
  if (category.includes('promo') || category.includes('credit')) return 'gift';
  return 'notifications';
}

// Cheap relative time — "5m", "2h", "3d", or fall back to a short date.
function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = now - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${fmtDateShort(iso)} · ${fmtTime(iso)}`;
}
