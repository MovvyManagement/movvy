import React from 'react';
import { Text, View } from 'react-native';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'dark';

// Dark-mode tone mapping — keeps the badge legible on near-black while
// preserving the semantic colour (success stays green, danger stays red).
const tones: Record<Tone, { bg: string; text: string }> = {
  neutral: {
    bg: 'bg-silver-100 dark:bg-night-200',
    text: 'text-ink-700 dark:text-mist-100',
  },
  success: {
    bg: 'bg-brand-50 dark:bg-brand-900',
    text: 'text-brand-700 dark:text-brand-300',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/40',
    text: 'text-warning',
  },
  danger: {
    bg: 'bg-red-50 dark:bg-red-900/40',
    text: 'text-danger',
  },
  brand: {
    bg: 'bg-brand-600 dark:bg-brand-500',
    text: 'text-white',
  },
  dark: {
    bg: 'bg-ink-900 dark:bg-night-200',
    text: 'text-white',
  },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View
      className={`${t.bg} rounded-full px-3 py-1 self-start`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Text
        className={`${t.text} text-xs font-semibold`}
        // Badges break their parent row when scaled; keep them small.
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Text>
    </View>
  );
}
