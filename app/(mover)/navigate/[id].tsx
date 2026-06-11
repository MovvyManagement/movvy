// =============================================================================
// /(mover)/navigate/[id] — in-app turn-by-turn for a driver's active job
//
// Replaces the "Open in Maps" deep-link with a Movvy-native navigation
// surface — same idea as Uber Driver. The driver gets:
//   • Full-screen live map with their pin + destination
//   • Big ETA + distance card at the top
//   • Step list (HQ → pickup → drop-off) with the current leg highlighted
//   • Primary CTA: flag the next status (Arrived / Loaded / Completed)
//   • Secondary "Open in external maps" link kept as a backup
//
// We deliberately do NOT call Google Directions — that's a paid API. ETA is
// estimated from straight-line distance + driver's current speed (see
// useDriverNavigation). When/if Google Directions gets wired into the geocoding
// edge function, we'll plug the polyline + turn instructions in here.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LiveMap } from '@/components/LiveMap';
import { Button } from '@/components/Button';
import { useBooking, useUpdateBookingStatus } from '@/lib/data';
import { useDriverNavigation } from '@/lib/useDriverNavigation';
import { openInMaps } from '@/lib/maps';
import { haptic } from '@/lib/haptics';
import type { BookingStatus } from '@/types';

type LegKey = 'to_pickup' | 'at_pickup' | 'to_dropoff' | 'at_dropoff' | 'done';

interface Leg {
  key: LegKey;
  label: string;
  sub: string;
  /** When the booking is in this status, this leg is the "current" one. */
  whenStatus: BookingStatus[];
}

const LEGS: Leg[] = [
  {
    key: 'to_pickup',
    label: 'Head to pickup',
    sub: 'Drive from HQ to the customer’s pickup address',
    whenStatus: ['assigned', 'confirmed', 'on_the_way'],
  },
  {
    key: 'at_pickup',
    label: 'Load at pickup',
    sub: 'Arrived · walk through, wrap, and load the truck',
    whenStatus: ['arrived', 'loading'],
  },
  {
    key: 'to_dropoff',
    label: 'Drive to drop-off',
    sub: 'Head to the customer’s drop-off address',
    whenStatus: ['in_transit'],
  },
  {
    key: 'at_dropoff',
    label: 'Unload at drop-off',
    sub: 'Arrived · unload, place items, walk through',
    whenStatus: ['unloading'],
  },
  {
    key: 'done',
    label: 'Move complete',
    sub: 'Job done · rate the customer',
    whenStatus: ['completed'],
  },
];

/** Map (current booking status) → (status after the primary CTA tap). */
function nextStatusFor(status: BookingStatus): BookingStatus | null {
  switch (status) {
    case 'assigned':
    case 'confirmed':
      return 'on_the_way';
    case 'on_the_way':
      return 'arrived';
    case 'arrived':
    case 'loading':
      return 'in_transit';
    case 'in_transit':
      return 'unloading';
    case 'unloading':
      return 'completed';
    default:
      return null;
  }
}

function ctaLabelFor(status: BookingStatus): string {
  switch (status) {
    case 'assigned':
    case 'confirmed':
      return "I've left HQ";
    case 'on_the_way':
      return 'Arrived at pickup';
    case 'arrived':
    case 'loading':
      return 'Loaded · heading to drop-off';
    case 'in_transit':
      return 'Arrived at drop-off';
    case 'unloading':
      return 'Job done';
    default:
      return 'Move complete';
  }
}

export default function NavigateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, isLoading } = useBooking(id);
  const update = useUpdateBookingStatus();
  const [advancing, setAdvancing] = useState(false);

  const status = (booking?.status ?? 'assigned') as BookingStatus;
  const headingTo: 'pickup' | 'dropoff' | null =
    status === 'on_the_way'
      ? 'pickup'
      : status === 'in_transit'
      ? 'dropoff'
      : null;

  // Resolve the active target coord based on which leg we're on.
  const target = useMemo(() => {
    if (!booking) return null;
    if (headingTo === 'pickup' && booking.pickup_lat && booking.pickup_lng) {
      return { lat: booking.pickup_lat, lng: booking.pickup_lng };
    }
    if (headingTo === 'dropoff' && booking.dropoff_lat && booking.dropoff_lng) {
      return { lat: booking.dropoff_lat, lng: booking.dropoff_lng };
    }
    // "At pickup" / "at drop-off" — still show the active address as the pin
    if ((status === 'arrived' || status === 'loading') && booking.pickup_lat) {
      return { lat: booking.pickup_lat, lng: booking.pickup_lng! };
    }
    if (status === 'unloading' && booking.dropoff_lat) {
      return { lat: booking.dropoff_lat, lng: booking.dropoff_lng! };
    }
    return null;
  }, [booking, headingTo, status]);

  const nav = useDriverNavigation({
    bookingId: id ?? '',
    target,
    enabled: !!booking && status !== 'completed' && status !== 'cancelled',
  });

  // Decide which leg is "current" so the step list highlights correctly.
  const currentLegKey: LegKey =
    LEGS.find((leg) => leg.whenStatus.includes(status))?.key ?? 'done';

  const targetLine = headingTo === 'pickup'
    ? booking?.pickup_line1
    : headingTo === 'dropoff'
    ? booking?.dropoff_line1 ?? null
    : null;

  const advance = async () => {
    if (!booking) return;
    const next = nextStatusFor(status);
    if (!next) return;
    setAdvancing(true);
    try {
      await update.mutateAsync({
        booking_id: booking.id,
        new_status: next as any,
      });
      // After 'arrived', also bump to 'loading' so the customer feed reads
      // accurately — same trick (mover)/active.tsx pulls. Skip the network
      // round-trip cost when the driver immediately flags loaded next.
      if (next === 'arrived') {
        setTimeout(() => {
          update.mutate({
            booking_id: booking.id,
            new_status: 'loading' as any,
          });
        }, 600);
      }
      haptic.success();
    } catch (e: any) {
      haptic.error();
      Alert.alert('Could not update', e?.message ?? 'Try again.');
    } finally {
      setAdvancing(false);
    }
  };

  if (isLoading || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 items-center justify-center">
        <ActivityIndicator color="#16A34A" />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Map fills the upper half so the driver always has a glanceable
          orientation — we explicitly do NOT stack a header above it because
          this is full-immersion navigation, like Uber Driver. */}
      <View style={{ flex: 1 }}>
        <LiveMap
          height={undefined as any}
          pickup={
            nav.coord
              ? { lat: nav.coord.lat, lng: nav.coord.lng, label: 'You' }
              : booking.pickup_lat && booking.pickup_lng
              ? {
                  lat: booking.pickup_lat,
                  lng: booking.pickup_lng,
                  label: booking.pickup_line1,
                }
              : undefined
          }
          dropoff={
            target
              ? { lat: target.lat, lng: target.lng, label: targetLine ?? 'Destination' }
              : undefined
          }
          showRoute
          caption={
            nav.error
              ? nav.error
              : headingTo
              ? `Headed to ${headingTo === 'pickup' ? 'pickup' : 'drop-off'}`
              : 'Stopped at the customer'
          }
        />

        {/* Close button — floats over the map */}
        <SafeAreaView
          edges={['top']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        >
          <View className="px-4 pt-2 flex-row items-center justify-between">
            <Pressable
              onPress={() => router.back()}
              className="h-11 w-11 rounded-full bg-white items-center justify-center"
              style={{
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 8,
                elevation: 4,
              }}
              hitSlop={6}
            >
              <Ionicons name="close" size={22} color="#0A0A0A" />
            </Pressable>

            {/* External-maps backup — some drivers still prefer Google/Apple
                Maps' real turn-by-turn for unfamiliar areas. */}
            {target ? (
              <Pressable
                onPress={() =>
                  openInMaps({ lat: target.lat, lng: target.lng, label: targetLine ?? undefined })
                }
                className="h-11 px-4 rounded-full bg-white items-center justify-center flex-row"
                style={{
                  shadowColor: '#000',
                  shadowOpacity: 0.15,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                <Ionicons name="open-outline" size={14} color="#0A0A0A" />
                <Text className="ml-1 text-xs font-bold text-ink-900">External maps</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </View>

      {/* Lower panel — ETA, leg list, primary CTA */}
      <SafeAreaView edges={['bottom']} className="bg-white">
        <View
          className="px-5 pt-5"
          style={{
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            marginTop: -28,
            backgroundColor: '#FFFFFF',
          }}
        >
          {/* ETA + remaining */}
          {headingTo ? (
            <View className="flex-row items-baseline gap-3">
              <View>
                <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                  ETA
                </Text>
                <Text className="text-4xl font-bold text-ink-900">
                  {nav.etaMinutes != null ? `${nav.etaMinutes} min` : '—'}
                </Text>
              </View>
              <View className="ml-auto items-end">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                  Remaining
                </Text>
                <Text className="text-xl font-bold text-ink-900">
                  {nav.remainingKm != null ? `${nav.remainingKm.toFixed(1)} km` : '—'}
                </Text>
              </View>
            </View>
          ) : (
            <View>
              <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                Now
              </Text>
              <Text className="mt-1 text-2xl font-bold text-ink-900">
                {LEGS.find((l) => l.key === currentLegKey)?.label ?? 'Active job'}
              </Text>
            </View>
          )}

          {/* Target address */}
          {targetLine ? (
            <View className="mt-3 rounded-2xl bg-silver-50 p-3 flex-row items-center">
              <View className="h-8 w-8 rounded-full bg-brand-600 items-center justify-center">
                <Ionicons name="navigate" size={14} color="#fff" />
              </View>
              <View className="ml-3 flex-1">
                <Text
                  className="text-sm font-bold text-ink-900"
                  numberOfLines={2}
                >
                  {targetLine}
                </Text>
                <Text className="text-[11px] text-silver-500">
                  {headingTo === 'pickup'
                    ? booking.pickup_city
                    : booking.dropoff_city ?? ''}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Leg list */}
          <View className="mt-4 rounded-2xl border border-silver-200 p-3">
            {LEGS.slice(0, 4).map((leg, i) => {
              const isCurrent = leg.key === currentLegKey;
              const isDone =
                LEGS.findIndex((l) => l.key === currentLegKey) > i;
              return (
                <View key={leg.key} className="flex-row items-start py-1.5">
                  <View
                    className={`h-6 w-6 rounded-full items-center justify-center ${
                      isDone
                        ? 'bg-brand-600'
                        : isCurrent
                        ? 'bg-ink-900'
                        : 'bg-silver-200'
                    }`}
                  >
                    {isDone ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : (
                      <Text
                        className={`text-[10px] font-bold ${
                          isCurrent ? 'text-white' : 'text-silver-500'
                        }`}
                      >
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  <View className="ml-3 flex-1">
                    <Text
                      className={`text-sm ${
                        isCurrent
                          ? 'font-bold text-ink-900'
                          : isDone
                          ? 'font-semibold text-brand-700'
                          : 'text-silver-500'
                      }`}
                    >
                      {leg.label}
                    </Text>
                    {isCurrent ? (
                      <Text className="text-[11px] text-silver-500 mt-0.5">
                        {leg.sub}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Primary CTA */}
          {nextStatusFor(status) ? (
            <View className="mt-4">
              <Button
                label={ctaLabelFor(status)}
                size="lg"
                fullWidth
                loading={advancing || update.isPending}
                onPress={advance}
              />
            </View>
          ) : (
            <View className="mt-4 rounded-2xl bg-brand-50 border border-brand-100 p-4 items-center">
              <Ionicons name="checkmark-circle" size={28} color="#047857" />
              <Text className="mt-2 text-base font-bold text-ink-900">Move complete</Text>
            </View>
          )}

          <Text className="mt-2 mb-1 text-center text-[11px] text-silver-500">
            ETA is estimated from your speed and crow-flies distance. For
            real turn-by-turn, tap External maps above.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
