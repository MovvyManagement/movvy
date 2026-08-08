// =============================================================================
// NotificationsInbox — shared in-app inbox, rendered by all three surfaces.
//
// The list UI (rows, unread badge, mark-all-read, skeletons, empty state) is
// identical for customers, movers and companies — they all read the same
// per-profile `notifications` table. The ONLY thing that differs is where a
// tapped row deep-links to, so that a driver never gets dropped into a
// customer screen (and vice-versa). That routing is driven by `surface`:
//
//   customer → booking/move rows open /(customer)/(tabs)/bookings
//              (customer referrals were pulled pre-launch — no such screen)
//   mover    → job/booking rows open /(mover)/(tabs)/jobs,
//              promo/credit/referral rows open /(mover)/referrals
//   company  → job/booking rows open /(company)/(tabs)/jobs
//              (companies have no referrals surface, so those stay put)
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
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
  useMarkNotificationsRead,
  type AppNotification,
} from '@/lib/data';
import { fmtTime, fmtDateShort } from '@/lib/format';

export type NotificationSurface = 'customer' | 'mover' | 'company';

// One visit shows at most this many unread. A full page means there is more
// waiting, so we say so rather than leaving the rest invisible.
const PAGE_SIZE = 50;

export function NotificationsInbox({ surface }: { surface: NotificationSurface }) {
  const { data: items, isLoading, refetch, isRefetching } = useNotifications(PAGE_SIZE);
  const markRead = useMarkNotificationRead();
  const markShown = useMarkNotificationsRead();

  // Opening the inbox marks what it shows as read, and the query is unread-only
  // — so the moment we mark, the live `items` would empty out while the user is
  // still looking at the list. To avoid that flicker: snapshot the first loaded
  // batch and render the snapshot for this visit. The rows stay put; they're
  // simply gone the NEXT time the inbox opens (the query no longer returns
  // them). `snapshot === null` means "haven't captured this visit yet".
  const [snapshot, setSnapshot] = useState<AppNotification[] | null>(null);
  const markedRef = useRef(false);

  // Mark ONLY the ids we actually rendered. This used to mark every unread row
  // for the profile, but the query is capped at PAGE_SIZE — so with more than a
  // page of unread mail, the overflow was marked read without ever being shown,
  // and a read notification never comes back. Anything past the first page was
  // silently destroyed on open. Now the overflow stays unread and surfaces on
  // the next visit (or a pull-to-refresh).
  const markBatch = (batch: AppNotification[]) => {
    if (markedRef.current) return;
    const ids = batch.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    markedRef.current = true;
    markShown.mutate(ids);
  };

  useEffect(() => {
    if (snapshot === null && items) {
      setSnapshot(items);
      markBatch(items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, snapshot]);

  // Pull-to-refresh re-captures the next unread batch (and marks that batch read).
  const onRefresh = async () => {
    markedRef.current = false;
    const r = await refetch();
    const fresh = (r.data ?? []) as AppNotification[];
    setSnapshot(fresh);
    markBatch(fresh);
  };

  // Render the frozen snapshot, not the live (soon-empty) query result.
  const shown = snapshot ?? items ?? [];

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
      // Customer referrals were pulled pre-launch — there is no
      // /(customer)/referrals screen. Booking activity opens the bookings
      // tab; anything else just stays on the notifications list.
      if (isBookingLike) router.push('/(customer)/(tabs)/bookings');
      return;
    }
    if (surface === 'mover') {
      if (isReferral) return void router.push('/(mover)/referrals');
      if (isBookingLike) router.push('/(mover)/(tabs)/jobs');
      return;
    }
    // company — no referrals surface; route job/booking activity to the feed
    if (isBookingLike) router.push('/(company)/(tabs)/jobs');
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Notifications" />
      </View>

      {isLoading && snapshot === null ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <CardSkeleton count={4} />
        </ScrollView>
      ) : shown.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="You're all caught up"
          body="New booking confirmations, status alerts, and move updates will show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor="#16A34A"
            />
          }
        >
          {shown.map((n) => (
            <NotificationRow key={n.id} item={n} onPress={() => onTap(n)} />
          ))}

          {/* A full page means more unread is queued behind this one. Say so —
              the alternative is a user assuming this was everything. */}
          {shown.length >= PAGE_SIZE ? (
            <Pressable onPress={onRefresh} className="mt-2 items-center py-3 active:opacity-70">
              <Text className="text-xs font-semibold text-brand-700">
                Pull down to load older notifications
              </Text>
            </Pressable>
          ) : null}
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
