import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { useThemed } from '@/lib/theme';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** Animated shimmer block used for predictable-layout loading states. */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  // Tone matches the schema border so skeletons disappear into the card.
  const tone = useThemed('#E4E4E7', '#33333A');

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: tone,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton — used in lists. */
export function CardSkeleton({ count = 3 }: { count?: number }) {
  const cardBg = useThemed('#FFFFFF', '#1E1E22');
  const cardBorder = useThemed('#E4E4E7', '#33333A');
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            marginBottom: 12,
            padding: 20,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: cardBorder,
            backgroundColor: cardBg,
          }}
        >
          <Skeleton width="60%" height={14} />
          <View style={{ height: 12 }} />
          <Skeleton width="90%" height={12} />
          <View style={{ height: 8 }} />
          <Skeleton width="40%" height={12} />
        </View>
      ))}
    </View>
  );
}
