import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';

type Role = { key: 'customer' | 'driver' | 'company'; title: string; body: string; icon: keyof typeof Ionicons.glyphMap; route: string };

const roles: Role[] = [
  {
    key: 'customer',
    title: 'I need movers',
    body: 'Book apartments, houses, offices, furniture delivery, and more.',
    icon: 'cube-outline',
    route: '/(customer)/home',
  },
  {
    key: 'driver',
    title: 'I want to move people',
    body: "Drive solo, set your own hours, get paid weekly.",
    icon: 'car-outline',
    route: '/(mover)/onboarding/personal',
  },
  {
    key: 'company',
    title: "I run a moving company",
    body: 'Add your fleet, manage drivers, get more jobs.',
    icon: 'business-outline',
    route: '/(company)/onboarding/company-info',
  },
];

export default function RoleSelect() {
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <View className="flex-1 px-6">
        <Text className="text-3xl font-bold text-ink-900">How will you use Movvy?</Text>
        <Text className="mt-2 text-base text-silver-500">
          Pick the option that fits. You can add more roles later.
        </Text>

        <View className="mt-8 gap-3">
          {roles.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => router.push(r.route as any)}
              className="flex-row items-center rounded-3xl border border-silver-200 bg-white p-5 active:opacity-80"
            >
              <View className="h-14 w-14 rounded-2xl bg-brand-50 items-center justify-center">
                <Ionicons name={r.icon} size={24} color="#047857" />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-base font-bold text-ink-900">{r.title}</Text>
                <Text className="text-sm text-silver-500 mt-1 leading-5">{r.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A1A1AA" />
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
