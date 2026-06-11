import React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  color?: string;
}

export function RatingStars({ value, onChange, size = 22, color = '#16A34A' }: Props) {
  return (
    <View className="flex-row gap-1">
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= value;
        const star = (
          <Ionicons
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? color : '#A1A1AA'}
          />
        );
        if (onChange) {
          return (
            <Pressable key={i} onPress={() => onChange(i)} hitSlop={6}>
              {star}
            </Pressable>
          );
        }
        return <View key={i}>{star}</View>;
      })}
    </View>
  );
}
