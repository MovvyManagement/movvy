// =============================================================================
// FleetGateBanner
//
// A crew can't accept ANY job until they own a truck and Movvy has approved its
// registration (org_can_take_booking, migration 0084). That's a hard stop, so
// it belongs at the top of the jobs feed — not as a surprise when Accept fails.
//
// Shows exactly one of: add a truck / in review / changes requested (with the
// reviewer's comment). Renders nothing once the registration is approved.
// Tapping opens the Trucks screen, which is where both documents are uploaded.
// =============================================================================

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FleetReadiness } from '@/lib/data';

export function FleetGateBanner({ fleet }: { fleet: FleetReadiness | undefined }) {
  if (!fleet) return null;

  const reg = fleet.registration?.status ?? 'missing';
  const noTruck = (fleet.truck_count ?? 0) === 0;
  if (!noTruck && reg === 'approved') return null;

  const state = noTruck
    ? {
        tone: 'red' as const,
        icon: 'car-outline' as const,
        title: 'Add your truck to start accepting jobs',
        body: 'We need the truck, its registration and its insurance. Jobs unlock once Movvy approves the registration.',
      }
    : reg === 'pending'
      ? {
          tone: 'amber' as const,
          icon: 'hourglass-outline' as const,
          title: 'Truck registration — in review',
          body: "Movvy is checking it now. You can accept jobs the moment it's approved.",
        }
      : reg === 'rejected'
        ? {
            tone: 'red' as const,
            icon: 'alert-circle-outline' as const,
            title: 'Truck registration — changes requested',
            body:
              fleet.registration?.rejection_reason ??
              'Re-upload your registration from the Trucks screen.',
          }
        : {
            tone: 'red' as const,
            icon: 'cloud-upload-outline' as const,
            title: 'Truck registration required',
            body: 'Upload your registration and insurance from the Trucks screen to start accepting jobs.',
          };

  const amber = state.tone === 'amber';

  return (
    <Pressable
      onPress={() => router.push('/(company)/trucks')}
      className={`mb-3 rounded-2xl border p-4 active:opacity-80 ${
        amber ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <View className="flex-row items-center">
        <Ionicons name={state.icon} size={18} color={amber ? '#B45309' : '#DC2626'} />
        <Text className="ml-2 flex-1 text-sm font-bold text-ink-900">{state.title}</Text>
      </View>
      <Text className="mt-1 text-xs text-silver-600 leading-5">{state.body}</Text>
      <Text className="mt-2 text-xs font-semibold text-brand-700">Open Trucks →</Text>
    </Pressable>
  );
}
