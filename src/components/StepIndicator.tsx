import React from 'react';
import { View, Text } from 'react-native';

interface Props {
  step: number;
  total: number;
  label?: string;
}

export function StepIndicator({ step, total, label }: Props) {
  return (
    <View className="px-5 mb-2">
      <View className="flex-row gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand-600' : 'bg-silver-200'}`}
          />
        ))}
      </View>
      <Text className="mt-3 text-xs font-semibold uppercase tracking-wider text-silver-500">
        Step {step} of {total}
        {label ? ` · ${label}` : ''}
      </Text>
    </View>
  );
}
