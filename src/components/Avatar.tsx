import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initials } from '@/lib/format';

interface Props {
  name: string;
  size?: number;
  tone?: 'brand' | 'silver' | 'dark';
}

export function Avatar({ name, size = 44, tone = 'brand' }: Props) {
  // Dark-mode tones: brand stays vivid (works on either bg), silver swaps
  // to the night-200 surface so it doesn't clash with dark cards.
  const bg =
    tone === 'brand'
      ? 'bg-brand-600 dark:bg-brand-500'
      : tone === 'dark'
      ? 'bg-ink-900 dark:bg-night-200'
      : 'bg-silver-200 dark:bg-night-300';
  const fg = tone === 'silver' ? '#0A0A0A' : '#FFFFFF';

  // initials() returns '' for generic placeholders ("Welcome", "Movvy
  // customer"). In that case show a neutral person icon instead of the
  // literal letter W — looks intentional rather than broken.
  const text = initials(name);

  return (
    <View
      className={`${bg} items-center justify-center rounded-full`}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {text ? (
        <Text
          className="font-bold"
          style={{ color: fg, fontSize: size * 0.36 }}
          maxFontSizeMultiplier={1.1}
        >
          {text}
        </Text>
      ) : (
        <Ionicons name="person" size={size * 0.5} color={fg} />
      )}
    </View>
  );
}
