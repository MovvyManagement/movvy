import React from 'react';
import { Pressable, View, Text } from 'react-native';

interface Props {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, sub, value, onChange }: Props) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      className="flex-row items-center justify-between py-4 border-b border-silver-100 active:opacity-70"
    >
      <View className="flex-1 pr-3">
        <Text className="text-base font-semibold text-ink-900">{label}</Text>
        {sub ? <Text className="text-xs text-silver-500 mt-0.5">{sub}</Text> : null}
      </View>
      <View
        className={`h-7 w-12 rounded-full justify-center ${value ? 'bg-brand-600' : 'bg-silver-200'}`}
      >
        <View
          className="h-6 w-6 rounded-full bg-white shadow"
          style={{ marginLeft: value ? 22 : 2 }}
        />
      </View>
    </Pressable>
  );
}
