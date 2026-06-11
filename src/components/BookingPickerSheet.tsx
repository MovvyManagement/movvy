// =============================================================================
// BookingPickerSheet — reusable booking selector for support flows
//
// Pops a slide-up list of the customer's bookings filtered by an allowed
// status set. The audit-log export, insurance claim, and dispute flows all
// start with "pick a move" — same UI, different filter.
//
// Empty state nudges the customer to book a move (insurance), wait until
// completion (audit log + claim), or re-check the filter (dispute).
// =============================================================================

import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBookings } from '@/lib/data';
import { fmtDateShort, fmtCurrency } from '@/lib/format';
import { EmptyState } from './EmptyState';
import type { BookingStatus } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Statuses the customer can select. */
  allowedStatuses: BookingStatus[];
  onPick: (booking: {
    id: string;
    short_code: string;
    pickup_line1: string;
    pickup_city: string;
    dropoff_line1: string | null;
    dropoff_city: string | null;
    scheduled_for_date: string;
    price_total_cents: number;
  }) => void;
  emptyHint?: string;
}

export function BookingPickerSheet({
  visible,
  onClose,
  title,
  subtitle,
  allowedStatuses,
  onPick,
  emptyHint,
}: Props) {
  const { data: bookings, isLoading } = useBookings();
  const list = (bookings ?? []).filter((b) =>
    (allowedStatuses as readonly string[]).includes(b.status),
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: '85%' }}
        >
          <View className="px-6 pt-5 pb-3 border-b border-silver-100">
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
            <Text className="text-xl font-bold text-ink-900">{title}</Text>
            {subtitle ? (
              <Text className="mt-1 text-sm text-silver-500">{subtitle}</Text>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            {isLoading && !bookings ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#16A34A" />
              </View>
            ) : list.length === 0 ? (
              <EmptyState
                icon="cube-outline"
                title="No eligible moves"
                body={emptyHint ?? 'You have no bookings matching this flow yet.'}
              />
            ) : (
              list.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => onPick(b as any)}
                  className="mb-2 rounded-2xl border border-silver-200 bg-white p-3 active:opacity-80"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-bold text-ink-900">
                      #{b.short_code}
                    </Text>
                    <Text className="text-[10px] uppercase font-bold text-silver-500">
                      {b.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text className="mt-1 text-xs text-silver-600" numberOfLines={1}>
                    {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                  </Text>
                  <View className="mt-1 flex-row items-center justify-between">
                    <Text className="text-[11px] text-silver-500">
                      {fmtDateShort(b.scheduled_for_date)}
                    </Text>
                    <Text className="text-[11px] font-semibold text-ink-900">
                      {fmtCurrency(b.price_total_cents / 100)}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
