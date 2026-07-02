// =============================================================================
// /(admin)/analytics — Movvy admin analytics
//
// Replaced the old hardcoded `monthly` / `cityMetrics` fixtures with the
// useAdminAnalytics hook. Every chart, KPI, and percentage on this
// screen now comes from a real Supabase query.
//
// What's shown:
//   • Last 6 months revenue chart with the current month highlighted.
//   • Trailing-6-month MoM growth %.
//   • Commission (Movvy take) + this-month take rate %.
//   • Cancel rate + completion rate (computed from booking statuses).
//   • Repeat-customer % (customers with 2+ bookings ever).
//   • Per-city booking volume + completion rate, sorted by volume.
//
// Empty-state copy makes the screen legible at $0 — better than rendering
// blank cards that look like a bug.
// =============================================================================

import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useAdminAnalytics } from '@/lib/data';
import { fmtCurrency } from '@/lib/format';

export default function AdminAnalytics() {
  const { data, isLoading, isError, refetch } = useAdminAnalytics();

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Analytics" showBack={false} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {isLoading || !data ? (
          <View className="py-8 items-center">
            <ActivityIndicator color="#16A34A" />
            <Text className="mt-3 text-xs text-silver-500">Loading live analytics…</Text>
          </View>
        ) : isError ? (
          <EmptyState
            icon="warning-outline"
            title="Couldn't load analytics"
            body="Try again in a moment."
          />
        ) : (
          <Body data={data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Body({ data }: { data: NonNullable<ReturnType<typeof useAdminAnalytics>['data']> }) {
  const { monthly, lifetime, completion_rate, cancel_rate, repeat_rate, cities, take_rate_this_month } = data;
  const max = Math.max(...monthly.map((m) => m.revenue_cents), 1);
  const thisMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  // MoM growth — null when we don't have a previous month with revenue
  // (avoids "+∞%" or "NaN%" early in the project).
  const momGrowth =
    prevMonth?.revenue_cents
      ? (thisMonth.revenue_cents - prevMonth.revenue_cents) / prevMonth.revenue_cents
      : null;

  const hasAnyRevenue = lifetime.revenue_cents > 0;

  if (!hasAnyRevenue) {
    return (
      <EmptyState
        icon="bar-chart-outline"
        title="Nothing to chart yet"
        body="Analytics light up once customers start booking. Every number here is a live query — when bookings exist, they'll show up automatically."
      />
    );
  }

  return (
    <>
      {/* Revenue chart */}
      <Card>
        <Text className="text-xs text-silver-500 uppercase font-semibold">
          Revenue (last 6 months)
        </Text>
        <Text className="text-2xl font-bold text-ink-900 mt-1">
          {fmtCurrency(thisMonth.revenue_cents / 100)}
        </Text>
        {momGrowth != null ? (
          <View className="flex-row items-center mt-1">
            <Ionicons
              name={momGrowth >= 0 ? 'trending-up' : 'trending-down'}
              size={14}
              color={momGrowth >= 0 ? '#16A34A' : '#EF4444'}
            />
            <Text
              className={`ml-1 text-xs font-semibold ${
                momGrowth >= 0 ? 'text-success' : 'text-danger'
              }`}
            >
              {momGrowth >= 0 ? '+' : ''}
              {Math.round(momGrowth * 100)}% MoM
            </Text>
          </View>
        ) : (
          <Text className="mt-1 text-xs text-silver-500">First month with revenue</Text>
        )}

        <View className="mt-5 flex-row items-end gap-3" style={{ height: 120 }}>
          {monthly.map((m, i) => {
            const isCurrent = i === monthly.length - 1;
            const heightPct = (m.revenue_cents / max) * 100;
            return (
              <View key={m.key} className="flex-1 items-center">
                <View
                  className="w-full rounded-t-lg bg-brand-600"
                  style={{
                    // Always show at least 2px so empty months render visibly.
                    height: Math.max(2, heightPct),
                    opacity: isCurrent ? 1 : 0.4,
                  }}
                />
                <Text className="text-xs text-silver-500 mt-2">{m.label}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      <View className="mt-3 flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-silver-500 uppercase font-semibold">Commission</Text>
          <Text className="text-xl font-bold text-ink-900 mt-1">
            {fmtCurrency(thisMonth.commission_cents / 100)}
          </Text>
          <Text className="text-xs text-silver-500 mt-1">
            {Math.round(take_rate_this_month * 100)}% take rate
          </Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-silver-500 uppercase font-semibold">Cancel rate</Text>
          <Text className="text-xl font-bold text-ink-900 mt-1">
            {(cancel_rate * 100).toFixed(1)}%
          </Text>
          <Text className="text-xs text-silver-500 mt-1">
            {Math.round(completion_rate * 100)}% completed
          </Text>
        </Card>
      </View>

      <View className="mt-3 flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-silver-500 uppercase font-semibold">Repeat customers</Text>
          <Text className="text-xl font-bold text-ink-900 mt-1">
            {Math.round(repeat_rate * 100)}%
          </Text>
          <Text className="text-xs text-silver-500 mt-1">2+ bookings</Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-silver-500 uppercase font-semibold">Total bookings</Text>
          <Text className="text-xl font-bold text-ink-900 mt-1">{lifetime.booking_count}</Text>
          <Text className="text-xs text-silver-500 mt-1">Trailing 6 months</Text>
        </Card>
      </View>

      <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
        City performance
      </Text>
      {cities.length === 0 ? (
        <Card>
          <Text className="text-xs text-silver-500">No completed bookings yet.</Text>
        </Card>
      ) : (
        <Card padded={false}>
          {cities.map((c, i) => (
            <View
              key={c.city_name}
              className={`flex-row items-center px-5 py-4 ${
                i < cities.length - 1 ? 'border-b border-silver-100' : ''
              }`}
            >
              <Ionicons name="location" size={18} color="#0A0A0A" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">{c.city_name}</Text>
                <Text className="text-xs text-silver-500">
                  {c.total} booking{c.total === 1 ? '' : 's'}
                  {c.cancelled > 0 ? ` · ${c.cancelled} cancelled` : ''}
                </Text>
              </View>
              <Text
                className={`text-sm font-bold ${
                  c.completion_rate >= 0.9
                    ? 'text-success'
                    : c.completion_rate >= 0.7
                    ? 'text-ink-900'
                    : 'text-danger'
                }`}
              >
                {Math.round(c.completion_rate * 100)}%
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
