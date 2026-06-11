import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildCalendar, MIN_LEAD_DAYS, type CalendarDay } from '@/lib/scheduling';

interface Props {
  value?: string;            // selected ISO date
  onChange: (iso: string) => void;
  totalDays?: number;
  leadDays?: number;
  showHint?: boolean;
}

export function DateScroller({
  value,
  onChange,
  totalDays = 21,
  leadDays = MIN_LEAD_DAYS,
  showHint = true,
}: Props) {
  const days = buildCalendar(totalDays, leadDays);

  return (
    <View>
      {showHint ? (
        <View className="flex-row items-center mb-2">
          <Ionicons name="time-outline" size={12} color="#71717A" />
          <Text className="ml-1 text-xs text-silver-500">
            Movvy needs {leadDays}-day lead time — earliest available is {' '}
            <Text className="text-ink-900 font-semibold">
              {days.find((d) => !d.isLeadTime)?.weekday}, {days.find((d) => !d.isLeadTime)?.month}{' '}
              {days.find((d) => !d.isLeadTime)?.day}
            </Text>
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pr-5">
          {days.map((d) => (
            <DayCell key={d.iso} day={d} selected={d.iso === value} onPress={onChange} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function DayCell({
  day,
  selected,
  onPress,
}: {
  day: CalendarDay;
  selected: boolean;
  onPress: (iso: string) => void;
}) {
  if (day.isLeadTime) {
    return (
      <View
        className="h-20 w-16 rounded-2xl items-center justify-center border bg-silver-50 border-silver-200"
      >
        <View className="absolute top-1.5 right-1.5">
          <Ionicons name="lock-closed" size={10} color="#A1A1AA" />
        </View>
        <Text className="text-xs text-silver-400">{day.weekday}</Text>
        <Text className="text-xl font-bold text-silver-400">{day.day}</Text>
        <Text className="text-xs text-silver-400">{day.month}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onPress(day.iso)}
      className={`h-20 w-16 rounded-2xl items-center justify-center border active:opacity-80 ${
        selected ? 'border-brand-600 bg-brand-600' : 'border-silver-200 bg-white'
      }`}
    >
      <Text className={`text-xs ${selected ? 'text-white/80' : 'text-silver-500'}`}>
        {day.weekday}
      </Text>
      <Text className={`text-xl font-bold ${selected ? 'text-white' : 'text-ink-900'}`}>
        {day.day}
      </Text>
      <Text className={`text-xs ${selected ? 'text-white/80' : 'text-silver-500'}`}>{day.month}</Text>
    </Pressable>
  );
}
