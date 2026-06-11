import React from 'react';
import { Pressable, Text, ActivityIndicator, View } from 'react-native';
import { haptic } from '@/lib/haptics';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Override the accessibility label — defaults to `label`. */
  accessibilityLabel?: string;
  /** Hint surfaced to VoiceOver below the label. */
  accessibilityHint?: string;
}

// Dark-mode variants: brand greens stay readable on near-black, secondary
// inverts to the elevated night surface, ghost drops border for both schemes.
const variantClasses: Record<Variant, { bg: string; text: string; border: string }> = {
  primary: {
    bg: 'bg-brand-600 dark:bg-brand-500',
    text: 'text-white',
    border: 'border-brand-600 dark:border-brand-500',
  },
  secondary: {
    bg: 'bg-white dark:bg-night-100',
    text: 'text-ink-900 dark:text-mist-50',
    border: 'border-silver-300 dark:border-night-300',
  },
  ghost: {
    bg: 'bg-transparent',
    text: 'text-ink-900 dark:text-mist-50',
    border: 'border-transparent',
  },
  danger: {
    bg: 'bg-danger',
    text: 'text-white',
    border: 'border-danger',
  },
  dark: {
    bg: 'bg-ink-900 dark:bg-night-200',
    text: 'text-white',
    border: 'border-ink-900 dark:border-night-200',
  },
};

const sizeClasses: Record<Size, { pad: string; text: string; height: string }> = {
  sm: { pad: 'px-4', text: 'text-sm', height: 'h-10' },
  md: { pad: 'px-5', text: 'text-base', height: 'h-12' },
  lg: { pad: 'px-6', text: 'text-base', height: 'h-14' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  fullWidth,
  disabled,
  loading,
  iconLeft,
  iconRight,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const v = variantClasses[variant];
  const s = sizeClasses[size];
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        // Haptic strength scales with variant intent
        if (variant === 'danger') haptic.warning();
        else if (variant === 'primary' || variant === 'dark') haptic.medium();
        else haptic.light();
        onPress?.();
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      className={`${v.bg} ${v.border} ${s.pad} ${s.height} ${fullWidth ? 'w-full' : ''} ${
        disabled ? 'opacity-50' : 'active:opacity-80'
      } flex-row items-center justify-center rounded-2xl border`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'dark' || variant === 'danger' ? '#fff' : '#0A0A0A'} />
      ) : (
        <View className="flex-row items-center justify-center">
          {iconLeft ? <View className="mr-2">{iconLeft}</View> : null}
          <Text
            className={`${v.text} ${s.text} font-semibold`}
            // Tap-target labels shouldn't grow past 1.3× — they'd start
            // pushing icons off the edge of the pill.
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
          {iconRight ? <View className="ml-2">{iconRight}</View> : null}
        </View>
      )}
    </Pressable>
  );
}
