import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { fmtCurrency } from '@/lib/format';

const monthly = [
  { m: 'Jan', revenue: 18400 },
  { m: 'Feb', revenue: 22100 },
  { m: 'Mar', revenue: 26900 },
  { m: 'Apr', revenue: 31200 },
  { m: 'May', revenue: 38040 },
];

const cityMetrics = [
  { city: 'Calgary', bookings: 412, completion: '96%' },
  { city: 'Airdrie', bookings: 64, completion: '94%' },
  { city: 'Okotoks', bookings: 32, completion: '92%' },
];

export default function AdminAnalytics() {
  const max = Math.max(...monthly.map((m) => m.revenue));
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Analytics" showBack={false} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Card>
          <Text className="text-xs text-silver-500 uppercase font-semibold">
            Revenue (last 5 months)
          </Text>
          <Text className="text-2xl font-bold text-ink-900 mt-1">
            {fmtCurrency(monthly[monthly.length - 1].revenue)}
          </Text>
          <View className="flex-row items-center mt-1">
            <Ionicons name="trending-up" size={14} color="#16A34A" />
            <Text className="ml-1 text-xs text-success font-semibold">+22% MoM</Text>
          </View>

          <View className="mt-5 flex-row items-end gap-3" style={{ height: 120 }}>
            {monthly.map((m, i) => (
              <View key={m.m} className="flex-1 items-center">
                <View
                  className="w-full rounded-t-lg bg-brand-600"
                  style={{ height: (m.revenue / max) * 100, opacity: i === monthly.length - 1 ? 1 : 0.5 }}
                />
                <Text className="text-xs text-silver-500 mt-2">{m.m}</Text>
              </View>
            ))}
          </View>
        </Card>

        <View className="mt-3 flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Commission</Text>
            <Text className="text-xl font-bold text-ink-900 mt-1">{fmtCurrency(6467)}</Text>
            <Text className="text-xs text-silver-500 mt-1">17% take rate</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Cancel rate</Text>
            <Text className="text-xl font-bold text-ink-900 mt-1">3.8%</Text>
            <Text className="text-xs text-success mt-1 font-semibold">−0.7 pts</Text>
          </Card>
        </View>

        <View className="mt-3 flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Repeat customers</Text>
            <Text className="text-xl font-bold text-ink-900 mt-1">41%</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">CAC</Text>
            <Text className="text-xl font-bold text-ink-900 mt-1">$24</Text>
          </Card>
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
          City performance
        </Text>
        <Card padded={false}>
          {cityMetrics.map((c, i) => (
            <View
              key={c.city}
              className={`flex-row items-center px-5 py-4 ${
                i < cityMetrics.length - 1 ? 'border-b border-silver-100' : ''
              }`}
            >
              <Ionicons name="location" size={18} color="#0A0A0A" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">{c.city}</Text>
                <Text className="text-xs text-silver-500">{c.bookings} bookings</Text>
              </View>
              <Text className="text-sm font-bold text-success">{c.completion}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
