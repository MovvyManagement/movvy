import React from 'react';
import { View, Text } from 'react-native';
import type { BookingStatus } from '@/types';

const order: { key: BookingStatus; label: string }[] = [
  { key: 'assigned', label: 'Driver assigned' },
  { key: 'on_the_way', label: 'On the way to pickup' },
  { key: 'arrived', label: 'Arrived at pickup' },
  { key: 'loading', label: 'Loading' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'unloading', label: 'Unloading' },
  { key: 'completed', label: 'Completed' },
];

export function StatusTimeline({ current }: { current: BookingStatus }) {
  const currentIdx = order.findIndex((o) => o.key === current);
  return (
    <View className="px-1">
      {order.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const future = i > currentIdx;
        const dotBg = done || active ? 'bg-brand-600' : 'bg-silver-200';
        return (
          <View key={step.key} className="flex-row">
            <View className="items-center mr-3">
              <View className={`h-3 w-3 rounded-full mt-2 ${dotBg}`} />
              {i < order.length - 1 ? (
                <View className={`w-0.5 flex-1 my-1 ${done ? 'bg-brand-600' : 'bg-silver-200'}`} />
              ) : null}
            </View>
            <View className="flex-1 pb-5">
              <Text
                className={`text-base ${
                  active ? 'font-bold text-ink-900' : future ? 'text-silver-400' : 'text-ink-700 font-medium'
                }`}
              >
                {step.label}
              </Text>
              {active ? (
                <Text className="text-xs text-brand-700 font-semibold mt-0.5">In progress</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
