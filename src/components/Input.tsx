import React from 'react';
import { TextInput, View, Text, TextInputProps } from 'react-native';
import { useThemed } from '@/lib/theme';

interface Props extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Input({ label, hint, error, leftIcon, rightIcon, accessibilityLabel, ...rest }: Props) {
  // Placeholder colour needs to be theme-aware — light grey vanishes on a
  // near-black surface. Pulled from the canonical palette.
  const placeholderColor = useThemed('#A1A1AA', '#71717A');
  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-2 text-sm font-semibold text-ink-900 dark:text-mist-50">{label}</Text>
      ) : null}
      <View
        className={`flex-row items-center rounded-2xl border bg-white dark:bg-night-100 px-4 ${
          error
            ? 'border-danger'
            : 'border-silver-200 dark:border-night-300'
        }`}
        style={{ minHeight: 52 }}
      >
        {leftIcon ? <View className="mr-3">{leftIcon}</View> : null}
        <TextInput
          placeholderTextColor={placeholderColor}
          accessibilityLabel={accessibilityLabel ?? label}
          className="flex-1 text-base text-ink-900 dark:text-mist-50"
          style={{ paddingVertical: 14 }}
          {...rest}
        />
        {rightIcon ? <View className="ml-3">{rightIcon}</View> : null}
      </View>
      {error ? (
        <Text className="mt-1 text-xs text-danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text className="mt-1 text-xs text-silver-500 dark:text-mist-400">{hint}</Text>
      ) : null}
    </View>
  );
}
