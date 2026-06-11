import React from 'react';
import { View, Text } from 'react-native';

interface Props {
  done: number;
  total: number;
  label?: string;
}

/** Compact progress bar used on tracking ("Step 3 of 5 complete · 60%"). */
export function StepProgressBar({ done, total, label }: Props) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <View>
      <View className="flex-row items-center justify-between mb-1.5">
        <Text className="text-xs font-bold text-ink-900">
          {label ?? `Step ${done} of ${total} complete`}
        </Text>
        <Text className="text-xs text-silver-500">{pct}%</Text>
      </View>
      <View className="h-2 w-full rounded-full bg-silver-200 overflow-hidden">
        <View
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${pct}%` }}
        />
      </View>
    </View>
  );
}
