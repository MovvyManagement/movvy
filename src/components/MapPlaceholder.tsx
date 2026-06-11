import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  height?: number;
  caption?: string;
  showRoute?: boolean;
  driverInitial?: string;
}

// Placeholder visual until Google Maps is wired in via backend.
export function MapPlaceholder({ height = 280, caption, showRoute, driverInitial }: Props) {
  return (
    <View className="rounded-3xl overflow-hidden" style={{ height }}>
      <LinearGradient
        colors={['#ECFDF5', '#D1FAE5', '#A7F3D0']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <View className="flex-1 items-center justify-center px-6">
          {showRoute ? (
            <View className="w-full flex-row items-center justify-between mb-6">
              <View className="items-center">
                <View className="h-10 w-10 rounded-full bg-ink-900 items-center justify-center">
                  <Ionicons name="navigate" size={16} color="#fff" />
                </View>
                <Text className="mt-1 text-xs font-semibold text-ink-700">Pickup</Text>
              </View>
              <View className="flex-1 mx-3 h-0.5 bg-ink-900/40" />
              {driverInitial ? (
                <View className="items-center">
                  <View className="h-12 w-12 rounded-full bg-brand-600 items-center justify-center border-4 border-white">
                    <Text className="text-white text-base font-bold">{driverInitial}</Text>
                  </View>
                  <Text className="mt-1 text-xs font-semibold text-brand-700">Driver</Text>
                </View>
              ) : null}
              <View className="flex-1 mx-3 h-0.5 bg-ink-900/40 border-dashed" />
              <View className="items-center">
                <View className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center">
                  <Ionicons name="flag" size={16} color="#fff" />
                </View>
                <Text className="mt-1 text-xs font-semibold text-brand-700">Drop-off</Text>
              </View>
            </View>
          ) : (
            <Ionicons name="map-outline" size={42} color="#047857" />
          )}
          {caption ? (
            <Text className="mt-3 text-center text-sm text-ink-700">{caption}</Text>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}
