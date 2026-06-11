import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import {
  useAdminBookings,
  useAdminDisputes,
  useAdminPendingVerifications,
  useAdminSpendToday,
} from '@/lib/data';
import { fmtCurrency, fmtDateShort, fmtTime } from '@/lib/format';
import { supabaseConfigured } from '@/lib/supabase';

export default function AdminDashboard() {
  const bookings = useAdminBookings({ limit: 20 });
  const disputes = useAdminDisputes(true);
  const pending = useAdminPendingVerifications();
  const spend = useAdminSpendToday();

  const today = new Date().setUTCHours(0, 0, 0, 0);
  const bookingsToday = (bookings.data ?? []).filter(
    (b) => new Date(b.created_at).getTime() >= today,
  );
  const revenueTodayCents = bookingsToday.reduce((s, b) => s + (b.price_total_cents ?? 0), 0);

  const totalSpendUsd = Object.values(spend.data ?? {}).reduce(
    (s: number, v: any) => s + (v.usd ?? 0),
    0,
  );

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Operations" subtitle="Live · Calgary" showBack={false} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {!supabaseConfigured ? (
          <View className="rounded-2xl bg-amber-50 border border-amber-100 p-4 mb-4 flex-row">
            <Ionicons name="warning-outline" size={18} color="#F59E0B" />
            <Text className="ml-2 flex-1 text-xs text-ink-700 leading-5">
              Supabase not configured. Dashboard is showing zero / placeholder data.
            </Text>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-3">
          <View className="w-[48%]">
            <Card>
              <Text className="text-xs text-silver-500 uppercase font-semibold">Bookings today</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{bookingsToday.length}</Text>
            </Card>
          </View>
          <View className="w-[48%]">
            <Card>
              <Text className="text-xs text-silver-500 uppercase font-semibold">Revenue today</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency(revenueTodayCents / 100)}
              </Text>
            </Card>
          </View>
          <View className="w-[48%]">
            <Card>
              <Text className="text-xs text-silver-500 uppercase font-semibold">Open disputes</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {disputes.data?.length ?? 0}
              </Text>
            </Card>
          </View>
          <View className="w-[48%]">
            <Card>
              <Text className="text-xs text-silver-500 uppercase font-semibold">Pending review</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {(pending.data?.teams.length ?? 0) + (pending.data?.companies.length ?? 0)}
              </Text>
            </Card>
          </View>
        </View>

        <View className="mt-6 flex-row items-center justify-between mb-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            API spend today
          </Text>
          <Text className="text-xs font-bold text-ink-900">${totalSpendUsd.toFixed(2)}</Text>
        </View>
        <Card padded={false}>
          {Object.entries(spend.data ?? {}).length === 0 ? (
            <Text className="text-xs text-silver-500 px-5 py-4">No paid API calls today.</Text>
          ) : (
            Object.entries(spend.data ?? {}).map(([svc, s]: any, i, arr) => (
              <View
                key={svc}
                className={`flex-row items-center px-5 py-3 ${
                  i < arr.length - 1 ? 'border-b border-silver-100' : ''
                }`}
              >
                <Text className="flex-1 text-sm font-semibold text-ink-900">{svc}</Text>
                <Text className="text-xs text-silver-500 mr-3">{s.calls} calls · {s.cache_hits} cached</Text>
                <Text className="text-sm font-bold text-ink-900">${s.usd.toFixed(2)}</Text>
              </View>
            ))
          )}
        </Card>

        <View className="mt-6 flex-row items-center justify-between mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            Recent bookings
          </Text>
          <Pressable onPress={() => router.push('/(admin)/bookings')}>
            <Text className="text-sm font-semibold text-brand-700">See all</Text>
          </Pressable>
        </View>
        {bookings.isLoading ? (
          <ActivityIndicator color="#16A34A" />
        ) : (
          bookings.data?.slice(0, 8).map((b) => (
            <View key={b.id} className="mb-3">
              <Card>
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-ink-900">#{b.short_code}</Text>
                  <Badge label={b.status.replace(/_/g, ' ')} tone={b.status === 'completed' ? 'neutral' : 'success'} />
                </View>
                <Text className="text-xs text-silver-500 mt-2">
                  {b.pickup_city} → {b.dropoff_city ?? 'in-home'} · {fmtDateShort(b.scheduled_for_date)} {fmtTime(b.created_at)}
                </Text>
                <Text className="text-sm font-bold text-ink-900 mt-1">
                  {fmtCurrency(b.price_total_cents / 100)}
                </Text>
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
