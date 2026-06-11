import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemed } from '@/lib/theme';

interface Props {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Accessibility hint surfaced under the title in VoiceOver rotor. */
  accessibilityLabel?: string;
}

export function ScreenHeader({
  title,
  subtitle,
  showBack = true,
  onBack,
  right,
  accessibilityLabel,
}: Props) {
  // Chevron stays high-contrast on either scheme.
  const chevronColor = useThemed('#0A0A0A', '#FAFAFA');
  return (
    <View
      className="flex-row items-center justify-between px-5 pb-4 pt-2 bg-white dark:bg-night-100"
      accessible={!!title}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="header"
    >
      <View className="flex-row items-center flex-1">
        {showBack ? (
          <Pressable
            onPress={onBack ?? (() => router.back())}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to the previous screen"
            hitSlop={6}
            className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-silver-100 dark:bg-night-200 active:opacity-70"
          >
            <Ionicons name="chevron-back" size={22} color={chevronColor} />
          </Pressable>
        ) : null}
        <View className="flex-1">
          {title ? (
            <Text
              className="text-xl font-bold text-ink-900 dark:text-mist-50"
              maxFontSizeMultiplier={1.4}
            >
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text
              className="text-sm text-silver-500 dark:text-mist-400 mt-0.5"
              maxFontSizeMultiplier={1.4}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}
