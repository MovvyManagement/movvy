import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  label: string;
  sub?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}

export function Counter({ label, sub, value, onChange, min = 0, max = 20 }: Props) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View className="flex-row items-center justify-between py-4 border-b border-silver-100">
      <View className="flex-1 pr-3">
        <Text className="text-base font-semibold text-ink-900">{label}</Text>
        {sub ? <Text className="text-xs text-silver-500 mt-0.5">{sub}</Text> : null}
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={dec}
          disabled={value <= min}
          className={`h-9 w-9 rounded-full items-center justify-center border ${
            value <= min ? 'border-silver-200 bg-silver-50' : 'border-silver-300 bg-white'
          }`}
        >
          <Ionicons name="remove" size={18} color={value <= min ? '#D4D4D8' : '#0A0A0A'} />
        </Pressable>
        <Text className="mx-4 w-6 text-center text-base font-bold text-ink-900">{value}</Text>
        <Pressable
          onPress={inc}
          disabled={value >= max}
          className={`h-9 w-9 rounded-full items-center justify-center border ${
            value >= max ? 'border-silver-200 bg-silver-50' : 'border-brand-600 bg-brand-600'
          }`}
        >
          <Ionicons name="add" size={18} color={value >= max ? '#D4D4D8' : '#fff'} />
        </Pressable>
      </View>
    </View>
  );
}
