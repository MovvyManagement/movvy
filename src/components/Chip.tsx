import React from 'react';
import { Pressable, Text } from 'react-native';

interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
  accessibilityHint?: string;
}

export function Chip({ label, selected, onPress, small, accessibilityHint }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={4}
      className={`${
        selected
          ? 'bg-brand-600 border-brand-600 dark:bg-brand-500 dark:border-brand-500'
          : 'bg-white border-silver-300 dark:bg-night-100 dark:border-night-300'
      } border rounded-full active:opacity-70 ${small ? 'px-3 py-1.5' : 'px-4 py-2'}`}
    >
      <Text
        className={`${
          selected ? 'text-white' : 'text-ink-700 dark:text-mist-50'
        } ${small ? 'text-xs' : 'text-sm'} font-semibold`}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}
