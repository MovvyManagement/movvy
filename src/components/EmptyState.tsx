import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { useThemed } from '@/lib/theme';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'cube-outline', title, body, actionLabel, onAction }: Props) {
  // Icon foreground in dark mode lifts to mist-300 so the badge doesn't
  // disappear into the night-200 ring.
  const iconColor = useThemed('#71717A', '#A1A1AA');
  return (
    <View
      className="items-center justify-center py-16 px-8"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${title}${body ? '. ' + body : ''}`}
    >
      <View className="h-20 w-20 rounded-full bg-silver-100 dark:bg-night-200 items-center justify-center mb-5">
        <Ionicons name={icon} size={32} color={iconColor} />
      </View>
      <Text className="text-lg font-bold text-ink-900 dark:text-mist-50 text-center">
        {title}
      </Text>
      {body ? (
        <Text className="text-sm text-silver-500 dark:text-mist-400 text-center mt-2 leading-5">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-6 w-full">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
