import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, Linking, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { LiveMap } from '@/components/LiveMap';
import { EmptyState } from '@/components/EmptyState';
import { mockBookings } from '@/data/mockBookings';
import { useMyCurrentJob, useUpdateBookingStatus, useSubmitRating, useCancelBooking, useOpenDispute, useMyMembership, useMyTeamCurrentJob, useMyAssignedJobs, usePhoneProxy, placeProxyCall } from '@/lib/data';
import { NotificationBell } from '@/components/NotificationBell';
import { useTrackingHeartbeat } from '@/lib/useTrackingHeartbeat';
import { useToast } from '@/components/Toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';
import { useCompanyDriverRoster } from '@/lib/data';
import { RatingStars } from '@/components/RatingStars';
import { ChatSheet } from '@/components/ChatSheet';
import { fmtDateShort, fmtTime } from '@/lib/format';
import { BillingTimer } from '@/components/BillingTimer';
import { useRef, useEffect } from 'react';
import { openInMaps } from '@/lib/maps';
import { supabaseConfigured } from '@/lib/supabase';
import type { BookingStatus } from '@/types';

// =============================================================================
// 5-flag driver flow — explicit user instruction:
//   1. Left HQ            (heading to pickup)
//   2. Arrived at pickup
//   3. Left pickup        (heading to drop-off)
//   4. Arrived at drop-off
//   5. Job done
//
// Mapped onto the booking state machine via:
//   assigned/confirmed → on_the_way → arrived → loading → in_transit → unloading → completed
// The DB still records every status; the driver UI just exposes the 5 buttons.
// Customer gets a notification on every transition (DB trigger in migration 0009).
// =============================================================================

type FlagKey = 'left_hq' | 'arrived_pickup' | 'left_pickup' | 'arrived_dropoff' | 'completed';

interface Flag {
  key: FlagKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  fromStatus: BookingStatus[];
  toStatus: BookingStatus;
  currentMessage: string;
}

// Three big buttons drive the day. Customer is billed for the elapsed
// time between "We've left HQ" and "Finish Move":
//   • "We've left HQ" (status → on_the_way) starts the billing timer
//   • "Arrived at pickup" / "Loaded" / etc. are status updates only —
//     they advance the customer's notification copy but don't touch
//     the meter.
//   • "Finish Move" (status → completed) stops the timer + computes
//     the actual bill server-side via computeActualBill().
const FLAGS: Flag[] = [
  {
    key: 'left_hq',
    label: "We've left HQ",
    icon: 'play-circle-outline',
    fromStatus: ['assigned', 'confirmed'],
    toStatus: 'on_the_way',
    currentMessage: 'On the way to pickup · billing live',
  },
  {
    key: 'arrived_pickup',
    label: 'Arrived at pickup',
    icon: 'flag-outline',
    fromStatus: ['on_the_way'],
    toStatus: 'arrived',
    currentMessage: 'At pickup · loading',
  },
  {
    key: 'left_pickup',
    label: 'Loaded · heading to drop-off',
    icon: 'navigate-outline',
    fromStatus: ['arrived', 'loading'],
    toStatus: 'in_transit',
    currentMessage: 'On the way to drop-off',
  },
  {
    key: 'arrived_dropoff',
    label: 'Arrived at drop-off',
    icon: 'pin-outline',
    fromStatus: ['in_transit'],
    toStatus: 'unloading',
    currentMessage: 'Arrived at drop-off · unloading',
  },
  {
    key: 'completed',
    label: 'Finish Move',
    icon: 'checkmark-done-outline',
    fromStatus: ['unloading'],
    toStatus: 'completed',
    currentMessage: 'Move completed',
  },
];

function nextFlag(status: BookingStatus): Flag | null {
  return FLAGS.find((f) => f.fromStatus.includes(status)) ?? null;
}

function completedFlags(status: BookingStatus): Set<FlagKey> {
  const done = new Set<FlagKey>();
  if (['arrived','loading','in_transit','unloading','completed'].includes(status)) done.add('left_hq');
  if (['loading','in_transit','unloading','completed'].includes(status)) done.add('arrived_pickup');
  if (['unloading','completed'].includes(status)) done.add('left_pickup');
  if (status === 'completed') { done.add('arrived_dropoff'); done.add('completed'); }
  return done;
}

export default function MoverActive() {
  // Drivers under a company can't cancel/decline — that's the dispatcher's
  // call. Movers (2nd team member on a partner team) are passengers: they
  // see the same job their driver is on but every action button is hidden.
  const { data: membership } = useMyMembership();
  const isCompanyDriver = membership?.is_company_driver ?? false;
  const isPassengerMover = membership?.kind === 'team' && membership?.role === 'mover';
  // Hourly laborers (company drivers + team movers) are paid a wage, not per
  // move — so the completion card never promises per-move "earnings."
  const isHourly = membership?.is_hourly ?? false;

  // Drivers query their own assigned_driver_profile_id; movers (who are NOT
  // the assigned_driver) query their team's current booking instead so they
  // can follow along.
  const driverJob = useMyCurrentJob();
  const teamJob = useMyTeamCurrentJob();
  const liveJob = isPassengerMover ? teamJob.data : driverJob.data;
  const isLoading = isPassengerMover ? teamJob.isLoading : driverJob.isLoading;
  const update = useUpdateBookingStatus();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Live-location source: the ONE crew member whose phone feeds the customer's
  // map. Chosen at "We've left HQ"; falls back to the assigned performer. Only
  // the source's device broadcasts, so the customer's pin never jumps between
  // two crew on the same move.
  const trackingSourceId =
    (liveJob as any)?.tracking_profile_id ?? liveJob?.assigned_driver_profile_id ?? null;
  const isTrackingSource = !!user?.id && trackingSourceId === user.id;

  // Candidates to be the source = everyone active on this crew. The picker only
  // appears when there's a real choice (2+).
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const { data: crewRoster } = useCompanyDriverRoster(companyId);
  const sourceCandidates = React.useMemo(() => {
    const map = new Map<string, string>();
    if (user?.id) map.set(user.id, 'You');
    for (const m of crewRoster ?? []) {
      if (m.profile_id && !map.has(m.profile_id)) map.set(m.profile_id, m.full_name ?? 'Crew');
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [crewRoster, user?.id]);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);

  // Multi-job queue: the rest of the driver's assigned jobs (excluding the
  // one they're actively on). Company drivers usually have several queued up
  // by their dispatcher — seeing the next 2 lets them plan the rest of the
  // shift, get fuel between, etc. Solo teams rarely have more than one
  // assigned at a time so the list naturally stays empty for them.
  const allAssigned = useMyAssignedJobs();
  // "Up next" = other jobs assigned to me, today or later. The date guard keeps
  // stale/past leftovers (e.g. an old test booking still sitting at 'assigned')
  // from cluttering the queue with moves that are effectively dead.
  const todayStr = new Date().toISOString().slice(0, 10);
  const upNext = (allAssigned.data ?? [])
    .filter((j) => j.id !== liveJob?.id)
    .filter((j) => !j.scheduled_for_date || j.scheduled_for_date >= todayStr)
    .slice(0, 3);

  // Resolve customer's name from their profile (RLS lets the assigned driver read this)
  const customerProfile = useQuery({
    queryKey: ['customer-profile', liveJob?.customer_id],
    enabled: !!liveJob?.customer_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', liveJob!.customer_id)
        .maybeSingle();
      return data?.full_name ?? 'Customer';
    },
  });
  const customerName = customerProfile.data ?? 'Customer';
  const submitRating = useSubmitRating();
  const [showProblemSheet, setShowProblemSheet] = useState(false);
  const [showCustomerRating, setShowCustomerRating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const lastStatusRef = useRef<string | null>(null);

  // ── Live location heartbeat ────────────────────────────────────────────────
  // While the job is in a moving phase (on_the_way → unloading), ping the
  // driver's GPS every ~10s. The customer's live tracker subscribes to
  // booking_tracking inserts via Realtime, so their map pin moves in step
  // with the truck. Without this hook the customer only sees the pin if the
  // driver opens the in-app Navigate screen.
  const toast = useToast();
  useTrackingHeartbeat({
    bookingId: liveJob?.id,
    status: liveJob?.status as any,
    // ONLY the designated live-location source broadcasts, so two crew on the
    // same move never fight over the customer's pin.
    enabled: isTrackingSource,
  });

  // ── Phone proxy (Uber-style masked call) ───────────────────────────────────
  const phoneProxy = usePhoneProxy();
  const onCallCustomer = async () => {
    if (!liveJob) return;
    try {
      const res = await phoneProxy.mutateAsync(liveJob.id);
      if (res.ok && res.proxyNumber) {
        await placeProxyCall(res.proxyNumber);
      } else {
        // Twilio not wired yet — guide the driver to Message instead.
        toast.info(
          res.message ?? 'Direct calling is being set up. Use Message in the meantime.',
        );
        setShowChat(true);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start the call.");
    }
  };

  // 4.8 — when status transitions to 'completed', surface the rating prompt.
  // Only the driver rates the customer (one rating per booking from the
  // partner side); passenger movers don't get the prompt.
  useEffect(() => {
    const prev = lastStatusRef.current;
    if (
      !isPassengerMover &&
      liveJob?.status === 'completed' &&
      prev &&
      prev !== 'completed'
    ) {
      setShowCustomerRating(true);
    }
    lastStatusRef.current = liveJob?.status ?? null;
  }, [liveJob?.status, isPassengerMover]);

  const usingMock = !supabaseConfigured || !liveJob;
  const booking = usingMock
    ? mockBookings[0]
    : {
        id: liveJob.id,
        short_code: liveJob.short_code,
        status: liveJob.status as BookingStatus,
        pickup: { line1: liveJob.pickup_line1, city: liveJob.pickup_city, lat: liveJob.pickup_lat, lng: liveJob.pickup_lng },
        dropoff: {
          line1: liveJob.dropoff_line1 ?? 'In-home',
          city: liveJob.dropoff_city ?? '',
          lat: liveJob.dropoff_lat ?? undefined,
          lng: liveJob.dropoff_lng ?? undefined,
        },
        scheduled_for_date: liveJob.scheduled_for_date,
        scheduled_for_window: liveJob.scheduled_for_window ?? null,
        scheduled_for_window_starts_at: liveJob.scheduled_for_window_starts_at ?? null,
      };

  const status = booking.status as BookingStatus;
  const next = useMemo(() => nextFlag(status), [status]);
  const done = useMemo(() => completedFlags(status), [status]);

  // Early-start guard: a crew can only kick off the move on the DAY OF the
  // booking — not days early. Only the FIRST step ("We've left HQ") is gated;
  // once started, the rest of the flow is open. Compared as LOCAL calendar
  // dates so it flips exactly at local midnight, not UTC.
  const schedDate: string | null = !usingMock
    ? ((booking as any).scheduled_for_date ?? null)
    : null;
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const isFirstStep = next?.key === 'left_hq';
  const tooEarly = isFirstStep && !!schedDate && localToday < schedDate;

  const headedTo: 'pickup' | 'dropoff' | null =
    status === 'on_the_way' ? 'pickup' :
    status === 'in_transit' ? 'dropoff' : null;

  const advance = async () => {
    if (!next || usingMock) {
      Alert.alert('Demo mode', 'Status updates need a live booking. Create one as a customer first.');
      return;
    }
    if (tooEarly) {
      Alert.alert(
        'Not the move day yet',
        `This move is scheduled for ${fmtDateShort((booking as any).scheduled_for_date)}${
          (booking as any).scheduled_for_window ? ` · ${(booking as any).scheduled_for_window}` : ''
        }. You can start it on the day of the move.`,
      );
      return;
    }
    // First step (We've left HQ): if the crew has 2+ people, ask whose location
    // the customer should follow before we start broadcasting.
    if (next.key === 'left_hq' && sourceCandidates.length >= 2) {
      setSourceChoice(trackingSourceId ?? user?.id ?? null);
      setShowSourcePicker(true);
      return;
    }
    await doAdvance();
  };

  // The actual status transition (after the source picker, if any).
  const doAdvance = async () => {
    if (!next || !liveJob) return;
    try {
      await update.mutateAsync({ booking_id: liveJob.id, new_status: next.toStatus as any });
      if (next.toStatus === 'arrived') {
        setTimeout(() => update.mutate({ booking_id: liveJob.id, new_status: 'loading' as any }), 600);
      }
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? 'Try again.');
    }
  };

  // Confirm the picked live-location source, then start the move.
  const confirmSourceAndStart = async () => {
    if (sourceChoice && liveJob) {
      try {
        await supabase.rpc('set_tracking_source', {
          p_booking_id: liveJob.id,
          p_profile_id: sourceChoice,
        });
        qc.invalidateQueries({ queryKey: ['jobs', 'assigned'] });
      } catch (e: any) {
        // Non-fatal — the move still starts; tracking falls back to the driver.
        console.warn('[active] set_tracking_source failed', e);
      }
    }
    setShowSourcePicker(false);
    await doAdvance();
  };

  if (isLoading && supabaseConfigured) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 items-center justify-center">
        <ActivityIndicator color="#16A34A" />
      </SafeAreaView>
    );
  }

  if (supabaseConfigured && !liveJob) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="No active job" showBack={false} />
        </View>
        <EmptyState
          icon="cube-outline"
          title="No active move"
          body="When you accept a job from the jobs feed, it'll show up here."
          actionLabel="See available jobs"
          onAction={() => router.replace('/(mover)/(tabs)/jobs')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Active Job"
          showBack={false}
          subtitle={`#${(booking as any).short_code ?? booking.id}`}
          right={<NotificationBell href="/(mover)/notifications" />}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 220 }}>
        <LiveMap
          height={220}
          pickup={(booking.pickup as any).lat ? { lat: (booking.pickup as any).lat, lng: (booking.pickup as any).lng, label: booking.pickup.line1 } : undefined}
          dropoff={(booking.dropoff as any)?.lat ? { lat: (booking.dropoff as any).lat, lng: (booking.dropoff as any).lng, label: booking.dropoff.line1 } : undefined}
          showRoute
          caption={
            headedTo === 'pickup'  ? `Headed to pickup: ${booking.pickup.line1}` :
            headedTo === 'dropoff' ? `Headed to drop-off: ${booking.dropoff.line1}` :
            (next?.currentMessage ?? 'Job complete')
          }
        />

        {/* Billing timer — only relevant for the actual crew (not the
            company dispatcher viewing remotely). Shows the running clock
            once Begin Move is pressed, the final number once Finish Move
            is pressed, and a "Press Begin Move to start" empty state
            before the move kicks off. */}
        <BillingTimer
          startedAt={(liveJob as any)?.started_at ?? null}
          completedAt={(liveJob as any)?.completed_at ?? null}
          hourlyRateCustomerCents={(liveJob as any)?.hourly_rate_customer_cents ?? null}
          actualTotalCents={(liveJob as any)?.actual_total_cents ?? null}
          actualDriverPayoutCents={(liveJob as any)?.actual_driver_payout_cents ?? null}
          showDriverPayout={!isHourly}
          hideMoney={isHourly}
        />

        {/* In-app turn-by-turn navigation. Replaces the previous "Open in
            Maps" deep-link as the primary CTA — Uber Driver-style immersion.
            Long-press still kicks the driver out to external maps for when
            they want Google/Apple's real route engine. */}
        {headedTo && liveJob ? (
          <Pressable
            onPress={() => router.push(`/(mover)/navigate/${liveJob.id}`)}
            onLongPress={() =>
              openNativeMaps(
                headedTo === 'pickup' ? booking.pickup : booking.dropoff,
              )
            }
            className="mt-3 h-14 rounded-2xl bg-brand-600 active:opacity-90 flex-row items-center justify-center"
          >
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">
              Navigate {headedTo === 'pickup' ? 'to pickup' : 'to drop-off'}
            </Text>
            <Text className="ml-2 text-[10px] text-white/70 uppercase font-bold">
              in app
            </Text>
          </Pressable>
        ) : null}

        <Card className="mt-4">
          <View className="flex-row items-center">
            <Avatar name={customerName} size={48} tone="dark" />
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">{customerName}</Text>
              <Text className="text-xs text-silver-500">Contact via Movvy line</Text>
            </View>
          </View>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => setShowChat(true)}
              className="flex-1 flex-row items-center justify-center rounded-2xl bg-silver-100 active:opacity-80"
              style={{ height: 48 }}
            >
              <Ionicons name="chatbubble-ellipses" size={18} color="#0A0A0A" />
              <Text className="ml-2 text-sm font-bold text-ink-900">Message</Text>
            </Pressable>
            <Pressable
              onPress={onCallCustomer}
              disabled={phoneProxy.isPending}
              accessibilityRole="button"
              accessibilityLabel="Call customer through Movvy"
              accessibilityHint="Routes through a Movvy proxy line so your real number stays private"
              className={`flex-1 flex-row items-center justify-center rounded-2xl ${
                phoneProxy.isPending ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
              }`}
              style={{ height: 48 }}
            >
              <Ionicons name="call" size={18} color="#fff" />
              <Text className="ml-2 text-sm font-bold text-white">
                {phoneProxy.isPending ? 'Connecting…' : 'Call'}
              </Text>
            </Pressable>
          </View>
        </Card>

        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Update your status
          </Text>
          {FLAGS.map((f, i) => {
            const isDone = done.has(f.key);
            const isCurrent = next?.key === f.key;
            return (
              <View key={f.key} className="flex-row">
                <View className="items-center mr-3">
                  <View
                    className={`h-7 w-7 rounded-full items-center justify-center ${
                      isDone ? 'bg-brand-600' : isCurrent ? 'bg-ink-900' : 'bg-silver-200'
                    }`}
                  >
                    {isDone ? (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    ) : (
                      <Text className={`text-xs font-bold ${isCurrent ? 'text-white' : 'text-silver-500'}`}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  {i < FLAGS.length - 1 ? (
                    <View
                      className={`w-0.5 flex-1 my-1 ${isDone ? 'bg-brand-600' : 'bg-silver-200'}`}
                      style={{ minHeight: 18 }}
                    />
                  ) : null}
                </View>
                <View className="flex-1 pb-3">
                  <View className="flex-row items-center">
                    <Ionicons name={f.icon} size={16} color={isCurrent ? '#0A0A0A' : isDone ? '#047857' : '#A1A1AA'} />
                    <Text
                      className={`ml-2 text-sm ${
                        isCurrent ? 'font-bold text-ink-900' : isDone ? 'font-semibold text-brand-700' : 'text-silver-500'
                      }`}
                    >
                      {f.label}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Text className="ml-6 text-[11px] text-silver-500 mt-0.5">
                      {f.currentMessage} · the customer is notified
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>

        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Route
          </Text>
          <View className="flex-row">
            <View className="items-center mr-3">
              <View className={`h-3 w-3 rounded-full ${headedTo === 'pickup' ? 'bg-ink-900' : 'bg-silver-300'}`} />
              <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 22 }} />
              <View className={`h-3 w-3 rounded-full ${headedTo === 'dropoff' ? 'bg-brand-600' : 'bg-silver-300'}`} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-bold text-ink-900">{booking.pickup.line1}</Text>
                  <Text className="text-xs text-silver-500 mb-3">{booking.pickup.city}</Text>
                </View>
                <Pressable
                  onPress={() =>
                    openInMaps({
                      lat: (booking.pickup as any).lat,
                      lng: (booking.pickup as any).lng,
                      label: booking.pickup.line1,
                    })
                  }
                  className="h-8 px-3 rounded-full bg-silver-100 items-center justify-center flex-row active:opacity-80"
                  hitSlop={4}
                >
                  <Ionicons name="navigate-outline" size={14} color="#0A0A0A" />
                  <Text className="ml-1 text-[11px] font-semibold text-ink-900">Maps</Text>
                </Pressable>
              </View>
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-bold text-ink-900">{booking.dropoff.line1}</Text>
                  <Text className="text-xs text-silver-500">{booking.dropoff.city}</Text>
                </View>
                <Pressable
                  onPress={() =>
                    openInMaps({
                      lat: (booking.dropoff as any)?.lat,
                      lng: (booking.dropoff as any)?.lng,
                      label: booking.dropoff.line1,
                    })
                  }
                  className="h-8 px-3 rounded-full bg-brand-100 items-center justify-center flex-row active:opacity-80"
                  hitSlop={4}
                >
                  <Ionicons name="navigate-outline" size={14} color="#047857" />
                  <Text className="ml-1 text-[11px] font-semibold text-brand-700">Maps</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Card>

        {/* Up next — the rest of today's queue. Drivers under a company
            usually have multiple jobs lined up by dispatch, so seeing the
            next 2–3 lets them plan breaks + fuel between stops. Solo teams
            with no follow-up jobs just see this section disappear. */}
        {upNext.length > 0 ? (
          <Card className="mt-3">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Up next · {upNext.length}
              </Text>
              <Text className="text-[11px] text-silver-500">After this move</Text>
            </View>
            {upNext.map((j, idx) => (
              <View key={j.id} className={idx > 0 ? 'mt-3 pt-3 border-t border-silver-100' : ''}>
                <View className="flex-row items-center">
                  <View className="h-8 w-8 rounded-full bg-silver-100 items-center justify-center">
                    <Text className="text-xs font-bold text-silver-700">{idx + 2}</Text>
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-bold text-ink-900" numberOfLines={1}>
                      {j.pickup_line1} → {j.dropoff_line1 ?? 'in-home'}
                    </Text>
                    <Text className="text-[11px] text-silver-500 mt-0.5">
                      {j.scheduled_for_window ?? j.scheduled_for_date} · #{j.short_code}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
            {isCompanyDriver ? (
              <Text className="mt-3 text-[11px] text-silver-500 leading-4">
                Queued by your dispatcher. Tap the Jobs tab to see the full list.
              </Text>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 border-t border-silver-100 bg-white px-5 pt-3"
        style={{ paddingBottom: 28 }}
      >
        {/* Action buttons:
            • Passenger mover: read-only banner + chat (chat handled above)
            • Company driver: flag stops but no cancel
            • Solo team driver: flag stops + ProblemSheet (cancel option)
        */}
        {isPassengerMover ? (
          <View className="rounded-2xl bg-silver-100 p-4 items-center">
            <Ionicons name="eye-outline" size={24} color="#52525B" />
            <Text className="mt-2 text-sm font-bold text-ink-900">Following your driver</Text>
            <Text className="mt-1 text-xs text-silver-500 text-center leading-5">
              You'll see status updates in real time. Use the chat above to
              coordinate with the customer or your driver.
            </Text>
          </View>
        ) : next ? (
          tooEarly ? (
            <View className="rounded-2xl bg-silver-100 p-4 items-center">
              <Ionicons name="time-outline" size={22} color="#71717A" />
              <Text className="mt-2 text-sm font-bold text-ink-900">
                Scheduled for {fmtDateShort((booking as any).scheduled_for_date)}
                {(booking as any).scheduled_for_window ? ` · ${(booking as any).scheduled_for_window}` : ''}
              </Text>
              <Text className="mt-1 text-xs text-silver-500 text-center leading-5">
                You can start this move on the day of — the button unlocks then.
              </Text>
            </View>
          ) : (
            <Button label={next.label} size="lg" fullWidth loading={update.isPending} onPress={advance} />
          )
        ) : (
          <View className="rounded-2xl bg-brand-50 border border-brand-100 p-4 items-center">
            <Ionicons name="checkmark-circle" size={28} color="#047857" />
            <Text className="mt-2 text-base font-bold text-ink-900">Move complete</Text>
            <Text className="text-xs text-silver-500">
              {isHourly
                ? 'Logged to your shift — on to the next one.'
                : 'Earnings paid out in your next weekly batch.'}
            </Text>
          </View>
        )}

        {/* Report-a-problem footer:
            • Passenger mover: no link (movers route everything through driver)
            • Company driver: "Contact dispatcher" alert, no cancel option
            • Solo team driver: full ProblemSheet w/ cancel + dispute
        */}
        {isPassengerMover ? null : isCompanyDriver ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                'Contact your dispatcher',
                "Your dispatcher handles cancellations and re-assignments. Reach out to them — they can release or reassign this move from the company dispatch screen.",
              )
            }
            className="mt-3 items-center"
          >
            <Text className="text-sm text-brand-700 font-semibold">Contact dispatcher</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setShowProblemSheet(true)}
            className="mt-3 items-center"
          >
            <Text className="text-sm text-danger font-semibold">Report a problem</Text>
          </Pressable>
        )}
      </View>

      {/* 4.9 Cancel-with-reason chip picker — solo team driver only */}
      {!isCompanyDriver && !isPassengerMover ? (
        <ProblemSheet
          visible={showProblemSheet}
          onClose={() => setShowProblemSheet(false)}
          bookingId={(liveJob?.id) ?? booking.id}
        />
      ) : null}

      {/* 4.8 Rate the customer after completed */}
      <CustomerRatingModal
        visible={showCustomerRating}
        bookingId={liveJob?.id ?? null}
        onClose={() => setShowCustomerRating(false)}
        onSubmit={async (stars, tags) => {
          if (!liveJob) return;
          try {
            await submitRating.mutateAsync({
              booking_id: liveJob.id,
              party: 'partner_to_customer',
              overall: stars,
              tags,
            });
          } catch (e) {
            console.warn('[active] customer rating failed', e);
          } finally {
            setShowCustomerRating(false);
          }
        }}
      />

      {/* Chat with customer — slide-up sheet (replaces the deleted /chat route) */}
      <ChatSheet
        visible={showChat}
        bookingId={(liveJob?.id) ?? booking.id}
        peerName={customerName}
        onClose={() => setShowChat(false)}
      />

      {/* Whose location does the customer follow? — asked when a 2+ crew starts */}
      <Modal visible={showSourcePicker} transparent animationType="slide" onRequestClose={() => setShowSourcePicker(false)}>
        <Pressable
          onPress={() => setShowSourcePicker(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable onPress={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white px-6 pt-5 pb-8">
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
            <Text className="text-xl font-bold text-ink-900">Whose location do we follow?</Text>
            <Text className="mt-1 text-sm text-silver-500 leading-5">
              Pick the phone the customer's live map should track for this move. Only
              that phone shares its location.
            </Text>
            <View className="mt-4 gap-2">
              {sourceCandidates.map((c) => {
                const sel = sourceChoice === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setSourceChoice(c.id)}
                    className={`flex-row items-center rounded-2xl border p-4 ${
                      sel ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                    }`}
                  >
                    <Avatar name={c.name === 'You' ? (user?.email ?? 'You') : c.name} size={36} />
                    <Text className="ml-3 flex-1 text-base font-semibold text-ink-900">{c.name}</Text>
                    <Ionicons
                      name={sel ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={sel ? '#16A34A' : '#A1A1AA'}
                    />
                  </Pressable>
                );
              })}
            </View>
            <View className="mt-5">
              <Button
                label="Start move"
                size="lg"
                fullWidth
                loading={update.isPending}
                disabled={!sourceChoice}
                onPress={confirmSourceAndStart}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function CustomerRatingModal({
  visible,
  bookingId,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  bookingId: string | null;
  onClose: () => void;
  onSubmit: (stars: number, tags: string[]) => void;
}) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);

  const TAG_OPTIONS = ['On time', 'Friendly', 'Light load', 'Easy access', 'Communicative', 'Tough job'];
  const toggleTag = (t: string) =>
    setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
        <View className="rounded-3xl bg-white p-6">
          <Text className="text-xl font-bold text-ink-900 text-center">Rate the customer</Text>
          <Text className="mt-1 text-sm text-silver-500 text-center">
            Helps Movvy match better crews next time.
          </Text>
          <View className="mt-4 items-center">
            <RatingStars value={stars} onChange={setStars} size={32} />
          </View>
          <View className="mt-5 flex-row flex-wrap gap-2 justify-center">
            {TAG_OPTIONS.map((t) => {
              const sel = tags.includes(t);
              return (
                <Pressable
                  key={t}
                  onPress={() => toggleTag(t)}
                  className={`rounded-full border px-3 py-1.5 ${
                    sel ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-300'
                  }`}
                >
                  <Text className={`text-xs font-semibold ${sel ? 'text-white' : 'text-ink-700'}`}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => bookingId && onSubmit(stars, tags)}
            disabled={!stars}
            className={`mt-6 h-12 rounded-2xl items-center justify-center ${
              stars ? 'bg-brand-600' : 'bg-silver-100'
            }`}
          >
            <Text className={`text-base font-bold ${stars ? 'text-white' : 'text-silver-400'}`}>
              Submit rating
            </Text>
          </Pressable>
          <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
            <Text className="text-sm text-silver-500">Skip</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ───── Helpers + ProblemSheet ────────────────────────────────────────────────

/** Open native turn-by-turn navigation to a coord. */
function openNativeMaps(target: { lat?: number; lng?: number; line1: string }) {
  if (!target.lat || !target.lng) {
    Alert.alert('No coordinates', 'This address has no coords yet.');
    return;
  }
  const q = encodeURIComponent(target.line1);
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${target.lat},${target.lng}&q=${q}`
      : `google.navigation:q=${target.lat},${target.lng}&mode=d`;
  Linking.openURL(url).catch(() => {
    // Fallback to web Google Maps if neither app responds
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`);
  });
}

const PROBLEM_REASONS = [
  { key: 'traffic', label: 'Heavy traffic / delayed' },
  { key: 'breakdown', label: 'Truck issue / breakdown' },
  { key: 'illness', label: 'Crew illness' },
  { key: 'customer_no_show', label: 'Customer not at pickup' },
  { key: 'access_issue', label: 'Building access problem' },
  { key: 'too_much_stuff', label: 'Underestimated load' },
  { key: 'safety', label: 'Safety concern' },
  { key: 'other', label: 'Something else' },
];

function ProblemSheet({
  visible,
  onClose,
  bookingId,
}: {
  visible: boolean;
  onClose: () => void;
  bookingId: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const cancel = useCancelBooking();
  const openDispute = useOpenDispute();

  const submit = async (action: 'continue' | 'cancel') => {
    if (!selected) return;
    const label = PROBLEM_REASONS.find((r) => r.key === selected)?.label ?? selected;
    try {
      if (action === 'cancel') {
        await cancel.mutateAsync({
          booking_id: bookingId,
          reason: `Driver-side · ${selected} · ${label}`,
        });
        Alert.alert('Job cancelled', "We've notified the customer.");
      } else {
        // Log as a low-severity dispute so ops can see + reach out
        await openDispute.mutateAsync({
          booking_id: bookingId,
          kind: 'poor_service',
          severity: 'low',
          summary: `Driver flagged issue: ${selected} · ${label}`,
        });
        Alert.alert('Issue logged', `Logged for ops: ${label}. Continue the move when you can.`);
      }
      setSelected(null);
      onClose();
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message ?? 'Try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white p-6" style={{ paddingBottom: 32 }}>
          <View className="self-center h-1 w-12 rounded-full bg-silver-200 mb-4" />
          <Text className="text-xl font-bold text-ink-900">What's going on?</Text>
          <Text className="text-sm text-silver-500 mt-1">Pick a reason — helps Movvy ops + the customer.</Text>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {PROBLEM_REASONS.map((r) => {
              const sel = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setSelected(r.key)}
                  className={`rounded-full border px-4 py-2.5 ${
                    sel ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-300'
                  }`}
                >
                  <Text className={`text-sm font-semibold ${sel ? 'text-white' : 'text-ink-700'}`}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-6 gap-2">
            <Pressable
              onPress={() => submit('continue')}
              disabled={!selected}
              className={`h-12 rounded-2xl items-center justify-center ${
                selected ? 'bg-ink-900 active:opacity-90' : 'bg-silver-100'
              }`}
            >
              <Text className={`text-sm font-bold ${selected ? 'text-white' : 'text-silver-400'}`}>
                Log issue and keep going
              </Text>
            </Pressable>
            <Pressable
              onPress={() => submit('cancel')}
              disabled={!selected}
              className="h-12 rounded-2xl items-center justify-center bg-white border border-danger active:opacity-80"
            >
              <Text className="text-sm font-bold text-danger">Cancel this job</Text>
            </Pressable>
            <Pressable onPress={onClose} className="h-12 items-center justify-center">
              <Text className="text-sm font-semibold text-silver-500">Never mind</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
