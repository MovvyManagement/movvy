// /(customer)/support/audit — booking picker for the audit-log export

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BookingPickerSheet } from '@/components/BookingPickerSheet';

export default function AuditIndex() {
  const [open, setOpen] = useState(true);
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Audit log export" />
      </View>

      <View className="p-5">
        <View className="rounded-3xl bg-silver-50 border border-silver-200 p-4 flex-row items-center">
          <View className="h-12 w-12 rounded-2xl bg-ink-900 items-center justify-center">
            <Ionicons name="archive" size={22} color="#fff" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink-900">Tamper-evident PDF</Text>
            <Text className="text-[11px] text-silver-600 mt-0.5">
              Every event on a move — status changes, audits, ratings — with
              a SHA-256 of the chain so the document can be verified later.
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
      </View>

      <BookingPickerSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          router.back();
        }}
        title="Which move?"
        subtitle="Pick the move you want a record for."
        allowedStatuses={[
          'completed', 'cancelled',
          'in_transit', 'unloading', 'loading', 'arrived', 'on_the_way',
          'assigned', 'confirmed',
        ]}
        emptyHint="No bookings on record yet — book a move first."
        onPick={(b) => {
          setOpen(false);
          router.replace(`/(customer)/support/audit/${b.id}`);
        }}
      />
    </SafeAreaView>
  );
}
