import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { DateScroller } from '@/components/DateScroller';
import { useBookingStore } from '@/store/bookingStore';
import { buildCalendar, firstBookableDay } from '@/lib/scheduling';

const windows = [
  '8:00 – 10:00 AM',
  '10:00 AM – 12:00 PM',
  '12:00 – 2:00 PM',
  '2:00 – 4:00 PM',
  '4:00 – 6:00 PM',
  '6:00 – 8:00 PM',
];

export default function ScheduleStep() {
  const setSchedule = useBookingStore((s) => s.setSchedule);
  const draft = useBookingStore((s) => s.draft);
  const days = useMemo(() => buildCalendar(), []);
  const earliest = firstBookableDay(days);

  const [mode, setMode] = useState<'asap' | 'scheduled'>(draft.scheduling ?? 'scheduled');
  const [date, setDate] = useState(
    draft.date && days.some((d) => d.iso === draft.date && !d.isLeadTime) ? draft.date : earliest.iso
  );
  const [time, setTime] = useState(draft.timeWindow ?? windows[1]);

  const next = () => {
    if (mode === 'asap') {
      setSchedule(earliest.iso, 'Earliest available — within lead time window', 'asap');
    } else {
      setSchedule(date, time, 'scheduled');
    }
    router.push('/(customer)/book/pricing');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={2} total={3} label="Date & time" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text className="text-2xl font-bold text-ink-900 mt-2">When do you need us?</Text>
        <Text className="mt-1 text-sm text-silver-500">
          Movvy needs a 3-day lead time so we can match the right crew and truck.
        </Text>

        <View className="mt-5 flex-row gap-3">
          <Pressable
            onPress={() => setMode('asap')}
            className={`flex-1 rounded-3xl border p-4 ${
              mode === 'asap' ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
            }`}
          >
            <Ionicons name="flash" size={20} color={mode === 'asap' ? '#047857' : '#0A0A0A'} />
            <Text className="mt-2 text-base font-bold text-ink-900">Earliest</Text>
            <Text className="text-xs text-silver-500 mt-1">First open slot</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('scheduled')}
            className={`flex-1 rounded-3xl border p-4 ${
              mode === 'scheduled' ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
            }`}
          >
            <Ionicons name="calendar" size={20} color={mode === 'scheduled' ? '#047857' : '#0A0A0A'} />
            <Text className="mt-2 text-base font-bold text-ink-900">Pick a date</Text>
            <Text className="text-xs text-silver-500 mt-1">Choose your slot</Text>
          </Pressable>
        </View>

        {mode === 'scheduled' ? (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
              Pick a date
            </Text>
            <DateScroller value={date} onChange={setDate} />

            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
              Time window
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {windows.map((w) => {
                const sel = w === time;
                return (
                  <Pressable
                    key={w}
                    onPress={() => setTime(w)}
                    className={`rounded-2xl border px-4 py-3 ${
                      sel ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                    }`}
                  >
                    <Text className={`text-sm font-semibold ${sel ? 'text-brand-700' : 'text-ink-900'}`}>
                      {w}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View className="mt-6 rounded-3xl bg-brand-50 border border-brand-100 p-5">
            <Ionicons name="information-circle-outline" size={20} color="#047857" />
            <Text className="mt-2 text-base font-bold text-ink-900">First available slot</Text>
            <Text className="text-sm text-silver-500 mt-1">
              We'll book you into our next opening on{' '}
              <Text className="text-ink-900 font-semibold">
                {earliest.weekday}, {earliest.month} {earliest.day}
              </Text>
              . The driver will confirm a time window once matched.
            </Text>
          </View>
        )}
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button label="Continue" size="lg" fullWidth onPress={next} />
      </View>
    </SafeAreaView>
  );
}
