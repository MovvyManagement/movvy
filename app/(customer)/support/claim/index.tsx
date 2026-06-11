// /(customer)/support/claim — booking picker for an insurance claim
//
// User lands here from the support hub; we filter to completed-but-not-
// already-claimed moves (any completed move within the 30-day coverage
// window) and route to /support/claim/[id] when they pick one.

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BookingPickerSheet } from '@/components/BookingPickerSheet';

export default function ClaimIndex() {
  const [open, setOpen] = useState(true);

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Insurance claim" />
      </View>

      <View className="p-5">
        <View className="rounded-3xl bg-brand-50 border border-brand-100 p-4 flex-row items-center">
          <View className="h-12 w-12 rounded-2xl bg-brand-600 items-center justify-center">
            <Ionicons name="shield-checkmark" size={22} color="#fff" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink-900">$5,000 coverage</Text>
            <Text className="text-[11px] text-silver-600 mt-0.5">
              Every completed Movvy move is covered for up to $5,000 in damage
              or loss for 30 days after drop-off.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => setOpen(true)}
          className="mt-4 h-14 rounded-2xl bg-ink-900 items-center justify-center flex-row active:opacity-90"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text className="ml-2 text-base font-bold text-white">Pick a move</Text>
        </Pressable>

        <Text className="mt-4 text-[11px] text-silver-500 text-center px-3 leading-4">
          We only show completed moves you can still claim against. Outside
          the 30-day window? Message support — we still hear you out.
        </Text>
      </View>

      <BookingPickerSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          router.back();
        }}
        title="Which move?"
        subtitle="Pick the move you want to claim against."
        allowedStatuses={['completed']}
        emptyHint="You have no completed moves yet — claims are filed after drop-off."
        onPick={(b) => {
          setOpen(false);
          router.replace(`/(customer)/support/claim/${b.id}`);
        }}
      />
    </SafeAreaView>
  );
}
