// =============================================================================
// /(mover)/availability — block days I'm not available
//
// Simple month-grid calendar. Tapping a day toggles whether the driver is
// blocked that date. Past dates are read-only. Today is highlighted.
// Optimistic updates make the toggle feel instant.
//
// Reached from the mover profile screen ("Working hours / availability").
// Backend: driver_availability_blocks table from migration 0019.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useMyBlockedDates, useToggleBlockedDate } from '@/lib/data';
import { haptic } from '@/lib/haptics';
import { supabaseConfigured } from '@/lib/supabase';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// YYYY-MM-DD for any date, in local timezone.
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const offset = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function AvailabilityScreen() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const { data: blocked, isLoading } = useMyBlockedDates();
  const toggle = useToggleBlockedDate();

  const grid = useMemo(
    () => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const monthLabel = cursor.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const todayIso = isoDay(today);

  const goPrev = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNext = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));

  const onCellPress = (date: Date) => {
    const iso = isoDay(date);
    if (iso < todayIso) return; // past dates are read-only
    const isBlocked = blocked?.has(iso) ?? false;
    haptic.light();
    toggle.mutate({ date: iso, currentlyBlocked: isBlocked });
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="My availability" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text className="text-sm text-silver-500 leading-5 mb-4">
          Tap any future date to block it. The matcher won't offer you jobs
          on blocked days, and your dispatcher (if you're under a company)
          will see them too.
        </Text>

        {/* Month nav */}
        <View className="rounded-3xl bg-white border border-silver-200 p-4">
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={goPrev}
              hitSlop={8}
              className="h-9 w-9 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
            >
              <Ionicons name="chevron-back" size={18} color="#0A0A0A" />
            </Pressable>
            <Text className="text-base font-bold text-ink-900">{monthLabel}</Text>
            <Pressable
              onPress={goNext}
              hitSlop={8}
              className="h-9 w-9 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
            >
              <Ionicons name="chevron-forward" size={18} color="#0A0A0A" />
            </Pressable>
          </View>

          <View className="flex-row mb-2">
            {WEEKDAY_LABELS.map((w, i) => (
              <View key={i} className="flex-1 items-center">
                <Text className="text-[11px] font-semibold text-silver-500">{w}</Text>
              </View>
            ))}
          </View>

          {isLoading && !blocked ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#16A34A" />
            </View>
          ) : (
            <View className="flex-row flex-wrap">
              {grid.map((cell, idx) => {
                if (!cell) {
                  return <View key={idx} style={{ width: '14.2857%', height: 44 }} />;
                }
                const iso = isoDay(cell);
                const isPast = iso < todayIso;
                const isToday = iso === todayIso;
                const isBlocked = blocked?.has(iso) ?? false;
                return (
                  <Pressable
                    key={iso}
                    onPress={() => onCellPress(cell)}
                    disabled={isPast}
                    style={{ width: '14.2857%' }}
                    className="h-11 items-center justify-center"
                  >
                    <View
                      className={`h-9 w-9 rounded-full items-center justify-center ${
                        isBlocked
                          ? 'bg-danger'
                          : isToday
                          ? 'border-2 border-brand-600'
                          : ''
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isPast
                            ? 'text-silver-300'
                            : isBlocked
                            ? 'font-bold text-white'
                            : isToday
                            ? 'font-bold text-brand-700'
                            : 'text-ink-900'
                        }`}
                      >
                        {cell.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Legend */}
        <View className="mt-4 rounded-2xl bg-white border border-silver-200 p-4">
          <View className="flex-row items-center mb-2">
            <View className="h-4 w-4 rounded-full bg-danger" />
            <Text className="ml-2 text-xs text-silver-600">Blocked — no jobs</Text>
          </View>
          <View className="flex-row items-center mb-2">
            <View className="h-4 w-4 rounded-full border-2 border-brand-600" />
            <Text className="ml-2 text-xs text-silver-600">Today</Text>
          </View>
          <View className="flex-row items-center">
            <View className="h-4 w-4 rounded-full bg-silver-100" />
            <Text className="ml-2 text-xs text-silver-600">Available</Text>
          </View>
        </View>

        {!supabaseConfigured ? (
          <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-3">
            <Text className="text-xs text-amber-800">
              Backend not connected — your changes won't persist in demo mode.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
