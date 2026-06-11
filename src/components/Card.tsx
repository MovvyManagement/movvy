import React from 'react';
import { View, Pressable, ViewProps } from 'react-native';

interface Props extends ViewProps {
  onPress?: () => void;
  padded?: boolean;
  bordered?: boolean;
  className?: string;
  /** A11y label for the tap target. Required when `onPress` is set. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Card({
  children,
  onPress,
  padded = true,
  bordered = true,
  className = '',
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: Props) {
  // Dark-mode mapping: white → night-100 surface, silver-200 → night-300
  // border. Keeps the elevation hierarchy (Card sits above the app bg).
  const base = `rounded-3xl bg-white dark:bg-night-100 ${
    bordered ? 'border border-silver-200 dark:border-night-300' : ''
  } ${padded ? 'p-5' : ''} ${className}`;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        className={`${base} active:opacity-80`}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View className={base} {...rest}>
      {children}
    </View>
  );
}
