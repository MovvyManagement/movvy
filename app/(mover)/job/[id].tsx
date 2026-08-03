// =============================================================================
// /(mover)/job/[id] — single-job preview before accepting.
//
// Reached from the Jobs feed by tapping a card. Previously read from
// `mockJobs` (which always fell back to mockJobs[0] because real booking
// ids never matched), and the Accept button just `router.replace`d into the
// active screen without actually calling useAcceptBooking — so the driver
// could "accept" jobs that never moved out of the open feed.
//
// Now we resolve the real booking by id, hydrate the screen from
// bookings + the customer profile (RLS lets the assigned-or-eligible
// driver read it once dispatch matches them), and Accept fires the real
// edge function with an Alert confirmation matching the Jobs-feed flow.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { LiveMap } from '@/components/LiveMap';
import {
  fmtCurrency,
  fmtDateShort,
  fmtDistance,
  fmtDuration,
  fmtTime,
} from '@/lib/format';
import { ChatSheet } from '@/components/ChatSheet';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useAcceptBooking, useMyMembership, acceptOnBehalfOf, useFleetReadiness } from '@/lib/data';
import { acceptBlock } from '@/lib/truckFit';
import { estimatePartnerPayoutCents } from '@/lib/partnerJobs';
import { haptic } from '@/lib/haptics';

interface BookingDetail {
  id: string;
  short_code: string;
  move_type: string;
  status: string;
  customer_id: string;
  pickup_line1: string;
  pickup_city: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  scheduled_for_window_starts_at: string | null;
  distance_km: number | null;
  duration_min: number | null;
  price_total_cents: number;
  price_commission_cents: number;
  details: Record<string, any> | null;
}

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accept = useAcceptBooking();
  const { data: fleet } = useFleetReadiness();
  const { data: membership } = useMyMembership();
  // Hourly laborers (company drivers + team movers) don't accept jobs and
  // aren't paid per move — so they never see the payout hero or Accept button.
  // They shouldn't normally reach this screen (their feed routes to the shift
  // view), but gate it defensively in case of a deep link / stale nav.
  const isHourly = membership?.is_hourly ?? false;
  const [showChat, setShowChat] = useState(false);

  // Pull the real booking row by id. RLS limits this to bookings the driver
  // is eligible to accept (open in their city) or already assigned to —
  // covers both the open-feed click-through and the "tap a row I'm already
  // on" case.
  const { data: booking, isLoading } = useQuery({
    queryKey: ['booking-detail', id],
    enabled: !!id && supabaseConfigured,
    queryFn: async (): Promise<BookingDetail | null> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, short_code, move_type, status, customer_id, pickup_line1, pickup_city, pickup_lat, pickup_lng, dropoff_line1, dropoff_city, dropoff_lat, dropoff_lng, scheduled_for_date, scheduled_for_window, scheduled_for_window_starts_at, distance_km, duration_min, price_total_cents, price_commission_cents, details',
        )
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data as BookingDetail | null) ?? null;
    },
  });

  // Customer name pulled separately — same pattern as the active-job screen.
  const customer = useQuery({
    queryKey: ['customer-profile', booking?.customer_id],
    enabled: !!booking?.customer_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', booking!.customer_id)
        .maybeSingle();
      return data?.full_name ?? 'Customer';
    },
  });

  if (isLoading && !booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Job details" />
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#16A34A" />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Job details" />
        </View>
        <EmptyState
          icon="cube-outline"
          title="Job not available"
          body="This job may have been taken by another partner or removed. Pull to refresh the Jobs feed."
          actionLabel="Back to jobs"
          onAction={() => router.replace('/(mover)/(tabs)/jobs')}
        />
      </SafeAreaView>
    );
  }

  // Partner share — routed through the shared estimator so the figure matches
  // the Jobs feed and dashboard exactly and can never drift between screens.
  const payoutCents = estimatePartnerPayoutCents(booking);
  const items =
    booking.move_type === 'home_move'
      ? `${booking.details?.bedrooms ?? 0}-bed ${booking.details?.dwelling ?? 'home'}`
      : booking.move_type.replace(/_/g, ' ');
  const scheduledIso =
    booking.scheduled_for_window_starts_at ?? `${booking.scheduled_for_date}T08:00:00Z`;

  const onAccept = () => {
    // Truck / registration / size gate — the server refuses these too, but a
    // sentence beats a raw 400. Same helper the jobs feed uses.
    const blocked = acceptBlock(fleet, booking);
    if (blocked) {
      haptic.warning();
      Alert.alert(
        blocked.title,
        blocked.body,
        blocked.fix === 'fleet'
          ? [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Trucks', onPress: () => router.push('/(company)/trucks') },
            ]
          : undefined,
      );
      return;
    }
    // bookings-accept needs the team/company you're accepting on behalf of —
    // see acceptOnBehalfOf. Without it the edge function rejects the call (400).
    const onBehalfOf = acceptOnBehalfOf(membership);
    if (!onBehalfOf) {
      Alert.alert(
        'One moment',
        "We're still loading your team details. Try again in a second.",
      );
      return;
    }
    Alert.alert(
      'Accept this job?',
      "You'll be locked in and the customer will be notified. Make sure you can make it.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          style: 'default',
          onPress: async () => {
            try {
              haptic.medium();
              await accept.mutateAsync({ booking_id: booking.id, ...onBehalfOf });
              haptic.success();
              router.replace('/(mover)/(tabs)/active');
            } catch (e: any) {
              haptic.error();
              Alert.alert('Could not accept', e?.message ?? 'Try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top', 'bottom']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Job details" subtitle={`#${booking.short_code}`} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 }}>
        {isHourly ? (
          <View className="rounded-3xl bg-ink-900 p-5">
            <Text className="text-white/70 text-xs font-semibold uppercase tracking-wider">
              Your move
            </Text>
            <Text className="text-white text-lg font-bold mt-1">
              Assigned by your dispatcher
            </Text>
            <Text className="text-white/70 text-xs mt-1 leading-4">
              You're on an hourly shift — just be there for the scheduled window below.
            </Text>
          </View>
        ) : (
          <View className="rounded-3xl bg-ink-900 p-5">
            <Text className="text-white/70 text-xs font-semibold uppercase tracking-wider">
              Estimated payout
            </Text>
            <Text className="text-white text-4xl font-bold mt-1">
              {fmtCurrency(payoutCents / 100)}
            </Text>
            <Text className="text-white/70 text-xs mt-1">After Movvy service fee</Text>
          </View>
        )}

        <Card className="mt-4">
          <View className="flex-row items-center">
            <Avatar name={customer.data ?? 'Customer'} size={48} tone="dark" />
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">
                {customer.data ?? 'Customer'}
              </Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                Contact via Movvy line once you accept
              </Text>
            </View>
            <Badge label={booking.move_type.replace(/_/g, ' ')} tone="brand" />
          </View>
        </Card>

        <Card className="mt-3" padded={false}>
          <View className="p-3">
            <LiveMap
              height={160}
              pickup={{
                lat: booking.pickup_lat,
                lng: booking.pickup_lng,
                label: booking.pickup_line1,
              }}
              dropoff={
                booking.dropoff_lat && booking.dropoff_lng
                  ? {
                      lat: booking.dropoff_lat,
                      lng: booking.dropoff_lng,
                      label: booking.dropoff_line1 ?? 'In-home',
                    }
                  : undefined
              }
              showRoute={!!booking.dropoff_lat}
              caption={`${fmtDistance(booking.distance_km ?? 0)} · ${fmtDuration(
                booking.duration_min ?? 0,
              )}`}
            />
          </View>
          <View className="px-5 pb-5">
            <View className="flex-row">
              <View className="items-center mr-3">
                <View className="h-3 w-3 rounded-full bg-ink-900" />
                <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 22 }} />
                <View className="h-3 w-3 rounded-full bg-brand-600" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-ink-900">{booking.pickup_line1}</Text>
                <Text className="text-xs text-silver-500 mb-3">{booking.pickup_city}</Text>
                <Text className="text-sm font-bold text-ink-900">
                  {booking.dropoff_line1 ?? 'In-home'}
                </Text>
                <Text className="text-xs text-silver-500">{booking.dropoff_city ?? ''}</Text>
              </View>
            </View>
          </View>
        </Card>

        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Job summary
          </Text>
          <View className="gap-2">
            <Row k="Items" v={items} />
            <Row
              k="Scheduled"
              v={`${fmtDateShort(booking.scheduled_for_date)} · ${fmtTime(scheduledIso)}`}
            />
            <Row k="Distance" v={fmtDistance(booking.distance_km ?? 0)} />
            <Row k="Drive time" v={fmtDuration(booking.duration_min ?? 0)} />
          </View>
        </Card>
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 border-t border-silver-100 bg-white px-5 pt-3 flex-row gap-3"
        style={{ paddingBottom: 28 }}
      >
        {isHourly ? (
          // Hourly workers can't accept — their dispatcher assigns the move.
          // They CAN message the customer about a move they're on, though, which
          // used to be impossible before the move went in-flight.
          <>
            {booking && booking.status !== 'searching' ? (
              <View className="flex-1">
                <Button
                  label="Message"
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onPress={() => setShowChat(true)}
                />
              </View>
            ) : null}
            <View className="flex-1">
              <Button label="Back" variant="secondary" size="lg" fullWidth onPress={() => router.back()} />
            </View>
          </>
        ) : (
          <>
            <View className="flex-1">
              <Button
                label="Pass"
                variant="secondary"
                size="lg"
                fullWidth
                onPress={() => router.back()}
              />
            </View>
            <View className="flex-1">
              <Button
                label="Accept"
                size="lg"
                fullWidth
                loading={accept.isPending}
                onPress={onAccept}
              />
            </View>
          </>
        )}
      </View>

      {/* Booking chat — reachable from a SCHEDULED move, not just an in-flight
          one. RLS scopes the thread to the assigned crew / their org admin. */}
      <ChatSheet
        visible={showChat}
        bookingId={id}
        peerName="Customer"
        quickReplies={[
          "Hi — I'm on your move",
          'Just confirming the details for move day',
          'Where should we park?',
          'Which floor / unit are we going to?',
        ]}
        onClose={() => setShowChat(false)}
      />
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-silver-500">{k}</Text>
      <Text className="text-sm font-semibold text-ink-900 max-w-[60%] text-right">{v}</Text>
    </View>
  );
}
