import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  /** Subtle outline variant for tighter headers. */
  variant?: 'filled' | 'tint';
}

/**
 * Movvy brand mark — green rounded square with a cube icon.
 * Reusable across headers (chat, review, track) so the brand feels consistent.
 */
export function MovvyMark({ size = 'sm', showText = false, variant = 'filled' }: Props) {
  const dim = size === 'sm' ? 28 : size === 'md' ? 36 : 44;
  const icon = size === 'sm' ? 14 : size === 'md' ? 18 : 22;
  const textSize = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-base' : 'text-xl';

  return (
    <View className="flex-row items-center">
      <View
        className={
          variant === 'filled'
            ? 'rounded-xl bg-brand-600 items-center justify-center'
            : 'rounded-xl bg-brand-50 border border-brand-100 items-center justify-center'
        }
        style={{ width: dim, height: dim }}
      >
        <Ionicons name="cube" size={icon} color={variant === 'filled' ? '#fff' : '#047857'} />
      </View>
      {showText ? (
        <Text className={`ml-2 ${textSize} font-bold text-ink-900`}>Movvy</Text>
      ) : null}
    </View>
  );
}
