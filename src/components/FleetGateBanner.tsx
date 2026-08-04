// =============================================================================
// FleetGateBanner
//
// A crew can't accept ANY job until the CREW owns a truck and Movvy has
// approved its registration (org_can_take_booking, migration 0084). Note whose
// truck: the check is org-wide, so one approved 24 ft truck covers everyone on
// the crew — a member with nothing registered to them can still be assigned to
// a 24 ft job. That's a hard stop when it applies, so it belongs at the top of
// the jobs feed rather than as a surprise when Accept fails.
//
// Shows exactly one of: add a truck / in review / changes requested (with the
// reviewer's comment). Renders nothing once the registration is approved.
// Only an ADMIN can act on it — crew are told to ask theirs instead of being
// sent to a screen they can't change.
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

  const isAdmin = fleet.is_org_admin !== false;

  const state = noTruck
    ? isAdmin
      ? {
          tone: 'red' as const,
          icon: 'car-outline' as const,
          title: 'Add a truck to start accepting jobs',
          body: "Your crew has no truck yet. Add one — or join a crew that has one, and their truck counts as yours.",
        }
      : {
          tone: 'red' as const,
          icon: 'car-outline' as const,
          title: 'Your crew has no truck yet',
          body: 'Ask your crew admin to add one. Once their truck is approved you can be assigned to jobs it fits — you don\'t need one of your own.',
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
              (isAdmin
                ? 'Re-upload the registration from Trucks → Documents.'
                : 'Your crew admin needs to re-upload it.'),
          }
        : {
            tone: 'red' as const,
            icon: 'cloud-upload-outline' as const,
            title: 'Truck registration needed',
            body: isAdmin
              ? "Add the truck's registration from Trucks → Documents to start accepting jobs."
              : "Your crew admin needs to upload the truck's registration before anyone can accept jobs.",
          };

  const amber = state.tone === 'amber';

  return (
    <Pressable
      onPress={() => (isAdmin ? router.push('/(company)/trucks') : undefined)}
      disabled={!isAdmin}
      className={`mb-3 rounded-2xl border p-4 active:opacity-80 ${
        amber ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <View className="flex-row items-center">
        <Ionicons name={state.icon} size={18} color={amber ? '#B45309' : '#DC2626'} />
        <Text className="ml-2 flex-1 text-sm font-bold text-ink-900">{state.title}</Text>
      </View>
      <Text className="mt-1 text-xs text-silver-600 leading-5">{state.body}</Text>
      {isAdmin ? (
        <Text className="mt-2 text-xs font-semibold text-brand-700">Open Trucks →</Text>
      ) : null}
    </Pressable>
  );
}
