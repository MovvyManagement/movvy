import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Stat {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}

const DEFAULT_STATS: Stat[] = [
  { icon: 'finger-print', value: '100%', label: 'BG-checked' },
  { icon: 'pricetag-outline', value: '$0', label: 'No hidden charges' },
  { icon: 'shield-checkmark', value: 'Trusted', label: 'Verified crews' },
];

export function TrustStrip({ stats = DEFAULT_STATS }: { stats?: Stat[] }) {
  return (
    <View className="flex-row rounded-3xl bg-white border border-silver-200 p-3">
      {stats.map((s, i) => (
        <React.Fragment key={s.label}>
          <View className="flex-1 items-center">
            <Ionicons name={s.icon} size={18} color="#047857" />
            <Text className="mt-1 text-sm font-bold text-ink-900">{s.value}</Text>
            <Text className="text-[10px] text-silver-500 mt-0.5 text-center">{s.label}</Text>
          </View>
          {i < stats.length - 1 ? (
            <View className="w-px bg-silver-200 my-1" />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}
