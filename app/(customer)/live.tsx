// =============================================================================
// /(customer)/live — Live Move tab
//
// One screen that bundles:
//   • live tracking (map + status + ETA)
//   • prominent Chat button to talk to the assigned crew
//   • Cancel + Report-issue actions
//   • Auto-popping review modal when the booking flips to `completed`
//
// The tab only shows in the bottom nav when there's an active in-flight
// booking (customer/_layout.tsx handles that via href: null).
//
// If the user lands here with no active booking (deep link / stale state),
// we show an empty state pointing them back to Home.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, Alert, Animated as RNAnimated, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { LiveMap } from '@/components/LiveMap';
import { BillingTimer } from '@/components/BillingTimer';
import { MovvyMark } from '@/components/MovvyMark';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { StepProgressBar } from '@/components/StepProgressBar';
import { EmptyState } from '@/components/EmptyState';
import { RatingStars } from '@/components/RatingStars';
import { ChatSheet } from '@/components/ChatSheet';
import {
  useActiveBooking, useLiveTracking, useBookingCrew, useCancelBooking, useOpenDispute, useSubmitRating, useSubmitTip,
  usePhoneProxy, placeProxyCall,
} from '@/lib/data';
import { useToast } from '@/components/Toast';
import { supabaseConfigured } from '@/lib/supabase';
import { haversineKm } from '@/lib/distance';
import { fmtDateShort, firstNameOf } from '@/lib/format';
import { mockBookings } from '@/data/mockBookings';
import { mockFallbacksEnabled } from '@/lib/mocks';
import { haptic } from '@/lib/haptics';
import type { BookingStatus } from '@/types';

const STEP_KEYS: BookingStatus[] = ['on_the_way','arrived','loading','in_transit','unloading','completed'];

function statusLabel(status: BookingStatus): string {
  switch (status) {
    case 'searching':  return 'Booking confirmed · arranging your crew';
    case 'assigned':   return 'Crew assigned · prepping';
    case 'confirmed':  return 'Crew confirmed';
    case 'on_the_way': return 'Driver is on the way to pickup';
    case 'arrived':    return 'Driver arrived at pickup';
    case 'loading':    return 'Loading your items';
    case 'in_transit': return 'On the way to drop-off';
    case 'unloading':  return 'Arrived at drop-off · unloading';
    case 'completed':  return 'Move completed';
    case 'cancelled':  return 'Cancelled';
    default:           return status;
  }
}

function destinationFor(status: BookingStatus): 'pickup' | 'dropoff' | null {
  if (status === 'on_the_way') return 'pickup';
  if (status === 'in_transit') return 'dropoff';
  return null;
}

function liveEtaMinutes(
  driver: { lat: number; lng: number } | null,
  target: { lat?: number | null; lng?: number | null } | null,
): number | null {
  if (!driver || !target?.lat || !target?.lng) return null;
  const km = haversineKm(driver, { lat: target.lat, lng: target.lng }) * 1.3;
  const minutes = (km / 50) * 60;
  return Math.max(1, Math.round(minutes));
}

export default function LiveMove() {
  const { data: live } = useActiveBooking();
  // Mock fallback is gated on the EXPO_PUBLIC_USE_MOCK_FALLBACKS dev flag
  // so production never shows a fake in-flight booking to a real customer
  // who happens to land here without an active move.
  const fallback = mockBookings.find((b) => b.status === 'in_transit') ?? mockBookings[0];
  const showMock = mockFallbacksEnabled && !supabaseConfigured && !live;

  // Normalize to common shape
  const booking = live
    ? {
        id: live.id,
        shortCode: live.short_code,
        status: live.status as BookingStatus,
        date: live.scheduled_for_date,
        pickup: { line1: live.pickup_line1, city: live.pickup_city, lat: live.pickup_lat, lng: live.pickup_lng },
        dropoff: { line1: live.dropoff_line1 ?? '', city: live.dropoff_city ?? '', lat: live.dropoff_lat, lng: live.dropoff_lng },
        totalCents: live.price_total_cents,
        totalDollars: live.price_total_cents / 100,
      }
    : showMock
    ? {
        id: fallback.id,
        shortCode: fallback.id,
        status: fallback.status as BookingStatus,
        date: fallback.date,
        pickup: { line1: fallback.pickup.line1, city: fallback.pickup.city, lat: fallback.pickup.lat, lng: fallback.pickup.lng },
        dropoff: { line1: fallback.dropoff.line1, city: fallback.dropoff.city, lat: fallback.dropoff.lat, lng: fallback.dropoff.lng },
        totalCents: Math.round((fallback.total ?? 0) * 100),
        totalDollars: fallback.total ?? 0,
      }
    : null;

  const mockMover = fallback.mover;
  const moverName = live ? null : mockMover?.name;
  const isCompleted = booking?.status === 'completed';

  // Realtime driver pin (only when supabase configured)
  const driverPing = useLiveTracking(supabaseConfigured && live ? live.id : undefined);

  // Who's moving me? Once a company/team accepts, surface their public name
  // (T15) — the tracker no longer hides behind an anonymous "Your crew". The
  // RPC is gated on customer_id, so this only ever resolves the customer's own
  // booking. Null while unassigned → falls back to "Your crew" below.
  const { data: crew } = useBookingCrew(live ? live.id : undefined);
  const crewName = crew?.display_name ?? moverName ?? null;

  const dest = booking ? destinationFor(booking.status) : null;
  const targetCoords = dest === 'pickup' ? booking?.pickup : dest === 'dropoff' ? booking?.dropoff : null;
  const targetLabel = dest === 'pickup' ? booking?.pickup.line1 : dest === 'dropoff' ? booking?.dropoff.line1 : null;
  const eta = liveEtaMinutes(
    driverPing ? { lat: driverPing.lat, lng: driverPing.lng } : null,
    targetCoords as any,
  );

  // STEP PROGRESS
  const currentStepIdx = booking ? STEP_KEYS.indexOf(booking.status) : -1;
  const stepsDone = Math.max(0, currentStepIdx + 1);

  // PULL-TO-REFRESH
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['bookings'] });
    setRefreshing(false);
  };

  // STATUS PULSE — animate ETA banner when status changes
  const prevStatus = useRef<BookingStatus | null>(null);
  const pulseAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!booking) return;
    if (prevStatus.current && prevStatus.current !== booking.status) {
      haptic.success();
      pulseAnim.setValue(0);
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        RNAnimated.timing(pulseAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]).start();
    }
    prevStatus.current = booking.status;
  }, [booking?.status, pulseAnim]);
  const pulseBg = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: ['#ECFDF5', '#A7F3D0'] });

  // Chat sheet — slide-up modal that replaces the deleted /chat/[id] route
  const [showChat, setShowChat] = useState(false);

  // Customer-service entry — route into the support hub (same screen the
  // Profile → Customer Service row opens). The hub bundles "Message Movvy
  // support" (live chat), Trigger SOS, insurance claim, dispute, audit
  // export, and emergency contact — so every safety/support path is one
  // tap from the live tracker. Headset icon in the header AND "Report an
  // issue" button both come here.
  const openSupportHub = () => router.push('/(customer)/support');

  // Cancel-booking flow — Alert confirm → useCancelBooking → toast + tab back.
  const cancelMutation = useCancelBooking();
  const onCancelBooking = () => {
    if (!booking) return;
    Alert.alert(
      'Cancel this move?',
      'Your crew has held this slot. Cancellations inside 48 hours of your move incur a small fee that goes to the crew. Continue?',
      [
        { text: 'Keep my move', style: 'cancel' },
        {
          text: 'Cancel move',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelMutation.mutateAsync({ booking_id: booking.id });
              haptic.success();
              toast.success('Move cancelled.');
              router.replace('/(customer)/home');
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't cancel — try again or contact support.");
            }
          },
        },
      ],
    );
  };

  // ── Phone proxy (Uber-style masked call) ───────────────────────────────────
  // Routes through proxy-session-create → the native dialer hits a Movvy
  // number that bridges to the driver. Neither side ever sees the other's
  // real phone. Falls back to opening Chat when the proxy isn't configured.
  const toast = useToast();
  const phoneProxy = usePhoneProxy();
  const onCallCrew = async () => {
    if (!live) return;
    try {
      const res = await phoneProxy.mutateAsync(live.id);
      if (res.ok && res.proxyNumber) {
        await placeProxyCall(res.proxyNumber);
      } else {
        toast.info(
          res.message ?? 'Direct calling is being set up. Use Message in the meantime.',
        );
        setShowChat(true);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start the call.");
    }
  };

  // ETA <5min full-screen alert
  const [showEtaAlert, setShowEtaAlert] = useState(false);
  const alertFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!booking) return;
    const key = `${booking.id}:${dest}`;
    if (!isCompleted && dest === 'pickup' && eta != null && eta <= 5 && alertFiredFor.current !== key) {
      alertFiredFor.current = key;
      haptic.warning();
      setShowEtaAlert(true);
    }
  }, [eta, dest, isCompleted, booking]);

  // REVIEW MODAL — pop automatically when status flips to completed.
  //
  // We snapshot { bookingId, totalDollars } at the moment of transition so
  // the modal can survive useActiveBooking() returning null on the next
  // poll (the active-booking query filters out completed statuses).
  const [showReview, setShowReview] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; totalDollars: number; moverName: string } | null>(null);
  const reviewedRef = useRef(false);
  useEffect(() => {
    if (
      booking?.status === 'completed' &&
      !reviewedRef.current &&
      prevStatus.current !== null  // ensure it's a transition, not initial load
    ) {
      reviewedRef.current = true;
      setReviewTarget({
        id: booking.id,
        totalDollars: booking.totalDollars,
        moverName: crewName ?? 'Movvy Crew',
      });
      setShowReview(true);
    }
  }, [booking?.status, booking?.id, booking?.totalDollars, crewName]);

  // ── EMPTY STATE ────────────────────────────────────────────────────────
  // If the booking just flipped to completed and we're showing the review
  // modal, keep rendering an overlay-friendly shell so the modal stays
  // mounted even after useActiveBooking() drops the (now non-active) record.
  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Live move" showBack={false} right={<MovvyMark size="sm" />} />
        </View>
        {showReview && reviewTarget ? (
          <View className="flex-1 items-center justify-center px-6">
            <View className="h-20 w-20 rounded-full bg-brand-100 items-center justify-center">
              <Ionicons name="checkmark-circle" size={40} color="#047857" />
            </View>
            <Text className="mt-4 text-2xl font-bold text-ink-900 text-center">Move complete</Text>
            <Text className="mt-2 text-base text-silver-500 text-center">
              Thanks for moving with Movvy. Tell us how it went.
            </Text>
          </View>
        ) : (
          <EmptyState
            icon="cube-outline"
            title="No active move"
            body="When you book your next move, you'll see live tracking, ETA, and a chat with your crew here."
            actionLabel="Book a move"
            onAction={() => router.push('/(customer)/home')}
          />
        )}
        <ReviewModal
          visible={showReview && !!reviewTarget}
          bookingId={reviewTarget?.id ?? ''}
          bookingTotalDollars={reviewTarget?.totalDollars ?? 0}
          moverName={reviewTarget?.moverName ?? 'Movvy Crew'}
          onClose={() => setShowReview(false)}
        />
      </SafeAreaView>
    );
  }

  // ── ACTIVE / TRACKING UI ───────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Live move"
          subtitle={`#${booking.shortCode}`}
          showBack={false}
          right={
            <View className="flex-row items-center gap-2">
              {/* Customer-service shortcut — opens the support chat directly.
                  Replaces the SOS button per design: SOS still lives at
                  /(customer)/support/sos for emergencies, but the more common
                  in-flight need is "I want to talk to Movvy" which is now
                  one tap from the live-move header. */}
              {!isCompleted ? (
                <Pressable
                  onPress={openSupportHub}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Customer service"
                  accessibilityHint="Opens the Movvy support hub"
                  className="h-9 w-9 rounded-full bg-ink-900 items-center justify-center active:opacity-90"
                >
                  <Ionicons name="headset" size={16} color="#fff" />
                </Pressable>
              ) : null}
              <MovvyMark size="sm" />
            </View>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16A34A" />}
      >
        {/* Step counter */}
        {!isCompleted ? (
          <View className="mb-4">
            <StepProgressBar done={stepsDone} total={STEP_KEYS.length} />
          </View>
        ) : null}

        {/* Map */}
        <LiveMap
          height={240}
          pickup={
            driverPing
              ? { lat: driverPing.lat, lng: driverPing.lng, label: 'Driver' }
              : booking.pickup.lat
              ? { lat: booking.pickup.lat as number, lng: booking.pickup.lng as number, label: booking.pickup.line1 }
              : undefined
          }
          dropoff={
            booking.dropoff?.lat
              ? { lat: booking.dropoff.lat as number, lng: booking.dropoff.lng as number, label: booking.dropoff.line1 }
              : undefined
          }
          showRoute={!isCompleted}
          caption={
            isCompleted
              ? 'Move completed'
              : dest && targetLabel
              ? `Headed to ${dest === 'pickup' ? 'pickup' : 'drop-off'}: ${targetLabel}${eta ? ` · ETA ${eta} min` : ''}`
              : statusLabel(booking.status)
          }
        />

        {/* Billing timer — running clock + dollar amount while the crew
            is on site, final actual_total_cents once they press Finish
            Move. Customer view, so showDriverPayout=false (they see the
            customer-side total, not the driver's 80% take). */}
        <BillingTimer
          startedAt={(booking as any).started_at ?? null}
          completedAt={(booking as any).completed_at ?? null}
          hourlyRateCustomerCents={(booking as any).hourly_rate_customer_cents ?? null}
          actualTotalCents={(booking as any).actual_total_cents ?? null}
        />

        {/* Live ETA pulse banner */}
        {!isCompleted && dest && eta != null ? (
          <RNAnimated.View
            style={{ backgroundColor: pulseBg }}
            className="mt-3 rounded-2xl border border-brand-100 p-4 flex-row items-center"
          >
            <View className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center">
              <Ionicons name="navigate" size={18} color="#fff" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                {dest === 'pickup' ? 'Driver heading to pickup' : 'Driver heading to drop-off'}
              </Text>
              <Text className="text-xs text-silver-600 mt-0.5" numberOfLines={1}>
                {targetLabel} · ETA {eta} min
              </Text>
            </View>
          </RNAnimated.View>
        ) : null}

        {/* Status badge + date */}
        <View className="mt-5 flex-row items-center justify-between">
          <Badge label={statusLabel(booking.status)} tone={isCompleted ? 'neutral' : 'success'} />
          <Text className="text-xs text-silver-500">{fmtDateShort(booking.date)}</Text>
        </View>

        {/* Crew card with prominent CHAT + CALL. Once a company/team accepts,
            this shows their real name + rating + the assigned driver — not the
            anonymous "Your crew" placeholder. */}
        <Card className="mt-4">
          <View className="flex-row items-center">
            <Avatar name={crewName ?? 'Crew'} size={56} />
            <View className="ml-3 flex-1">
              <View className="flex-row items-center">
                <Text className="text-base font-bold text-ink-900" numberOfLines={1}>
                  {crewName ?? 'Movvy Crew'}
                </Text>
                {/* Only badge a genuinely verified partner (mock is always
                    "verified" in dev so the UI still demos with a badge). */}
                {(crew ? crew.verified : !!mockMover) ? (
                  <View className="ml-2"><VerifiedBadge /></View>
                ) : null}
              </View>

              {crew ? (
                <>
                  {crew.rating_avg != null ? (
                    <View className="flex-row items-center mt-0.5">
                      <Ionicons name="star" size={12} color="#16A34A" />
                      <Text className="ml-1 text-xs text-ink-700 font-semibold">
                        {Number(crew.rating_avg).toFixed(1)}
                      </Text>
                      <Text className="text-xs text-silver-500">
                        {' · '}
                        {crew.rating_count ?? 0}{' '}
                        {(crew.rating_count ?? 0) === 1 ? 'review' : 'reviews'}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-xs text-silver-500 mt-0.5">New to Movvy</Text>
                  )}
                  {/* Surface the person actually arriving under the company brand. */}
                  {crew.driver_name ? (
                    <Text className="text-xs text-silver-500 mt-0.5" numberOfLines={1}>
                      {firstNameOf(crew.driver_name)} is your driver
                    </Text>
                  ) : null}
                </>
              ) : mockMover ? (
                <>
                  <View className="flex-row items-center mt-0.5">
                    <Ionicons name="star" size={12} color="#16A34A" />
                    <Text className="ml-1 text-xs text-ink-700 font-semibold">{mockMover.rating}</Text>
                    <Text className="text-xs text-silver-500"> · {mockMover.trips} moves</Text>
                  </View>
                  {mockMover.vehicle ? (
                    <Text className="text-xs text-silver-500 mt-0.5">{mockMover.vehicle}</Text>
                  ) : null}
                </>
              ) : (
                <Text className="text-xs text-silver-500 mt-0.5">
                  Arranging your crew — we'll show them here once assigned.
                </Text>
              )}
            </View>
          </View>

          {!isCompleted ? (
            <>
              <View className="mt-4 flex-row gap-2">
                <Pressable
                  onPress={() => setShowChat(true)}
                  className="flex-1 flex-row items-center justify-center rounded-2xl bg-silver-100 active:opacity-80"
                  style={{ height: 56 }}
                >
                  <Ionicons name="chatbubble-ellipses" size={22} color="#0A0A0A" />
                  <Text className="ml-2 text-base font-bold text-ink-900">Chat with crew</Text>
                </Pressable>
                <Pressable
                  onPress={onCallCrew}
                  disabled={phoneProxy.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Call your crew through Movvy"
                  accessibilityHint="Routes through a Movvy proxy line so your real number stays private"
                  className={`h-14 w-14 rounded-2xl items-center justify-center ${
                    phoneProxy.isPending
                      ? 'bg-silver-300'
                      : 'bg-brand-600 active:opacity-90'
                  }`}
                >
                  <Ionicons
                    name={phoneProxy.isPending ? 'hourglass-outline' : 'call'}
                    size={22}
                    color="#fff"
                  />
                </Pressable>
              </View>
              <View className="mt-3 flex-row items-center">
                <Ionicons name="shield-checkmark" size={12} color="#71717A" />
                <Text className="ml-1.5 text-[11px] text-silver-500">
                  Calls and texts route through a Movvy line — your real number is never shared.
                </Text>
              </View>
            </>
          ) : null}
        </Card>

        {/* Route detail */}
        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">Route</Text>
          <View className="flex-row">
            <View className="items-center mr-3">
              <View className="h-3 w-3 rounded-full bg-ink-900" />
              <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 24 }} />
              <View className="h-3 w-3 rounded-full bg-brand-600" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-ink-900">{booking.pickup.line1}</Text>
              <Text className="text-xs text-silver-500 mb-3">{booking.pickup.city}</Text>
              <Text className="text-sm font-bold text-ink-900">{booking.dropoff.line1}</Text>
              <Text className="text-xs text-silver-500">{booking.dropoff.city}</Text>
            </View>
          </View>
        </Card>

        {/* Bottom actions — Report an issue routes through the same
            support-chat thread the headset icon opens, so the customer
            doesn't have to learn two different paths to reach Movvy.
            Cancel opens the destructive confirm + cancellation flow. */}
        {!isCompleted ? (
          <View className="mt-4 gap-2">
            <Button
              label="Report an Issue"
              variant="secondary"
              fullWidth
              onPress={openSupportHub}
            />
            <Button
              label="Cancel"
              variant="ghost"
              fullWidth
              onPress={onCancelBooking}
              loading={cancelMutation.isPending}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* ETA <5min alert */}
      <Modal visible={showEtaAlert} transparent animationType="fade" onRequestClose={() => setShowEtaAlert(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
          <View className="rounded-3xl bg-white p-6">
            <View className="h-20 w-20 rounded-full bg-brand-600 items-center justify-center self-center">
              <Ionicons name="navigate" size={36} color="#fff" />
            </View>
            <Text className="mt-4 text-2xl font-bold text-ink-900 text-center">Your crew is arriving</Text>
            <Text className="mt-2 text-sm text-silver-500 text-center leading-5">
              About {eta ?? 5} min away. Time to grab keys, prop the door, and clear the loading path.
            </Text>
            <Pressable
              onPress={() => setShowEtaAlert(false)}
              className="mt-6 h-14 rounded-2xl bg-brand-600 items-center justify-center"
            >
              <Text className="text-base font-bold text-white">Got it</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowEtaAlert(false);
                setShowChat(true);
              }}
              className="mt-2 h-12 items-center justify-center"
            >
              <Text className="text-sm font-semibold text-brand-700">Message crew instead</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* AUTO-REVIEW MODAL on completion */}
      <ReviewModal
        visible={showReview}
        bookingId={booking.id}
        bookingTotalDollars={booking.totalDollars}
        moverName={moverName ?? 'Movvy Crew'}
        onClose={() => setShowReview(false)}
      />

      {/* Chat with crew — slide-up sheet (replaces the deleted /chat route) */}
      <ChatSheet
        visible={showChat}
        bookingId={booking.id}
        peerName={moverName ?? 'Movvy Crew'}
        onClose={() => setShowChat(false)}
      />

    </SafeAreaView>
  );
}

// ─── Auto-review modal ──────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'timeliness',      label: 'Timeliness' },
  { key: 'carefulness',     label: 'Carefulness' },
  { key: 'communication',   label: 'Communication' },
] as const;

const COMPLIMENT_TAGS = ['Friendly', 'Fast', 'Careful', 'On time', 'Strong'];

function ReviewModal({
  visible, bookingId, bookingTotalDollars, moverName, onClose,
}: {
  visible: boolean;
  bookingId: string;
  bookingTotalDollars: number;
  moverName: string;
  onClose: () => void;
}) {
  const [overall, setOverall] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tip, setTip] = useState<number | null>(null);

  const submitRating = useSubmitRating();
  const submitTip = useSubmitTip();

  const toggleTag = (t: string) =>
    setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const submit = async () => {
    try {
      await submitRating.mutateAsync({
        booking_id: bookingId,
        party: 'customer_to_partner',
        overall,
        professionalism: ratings.professionalism,
        timeliness: ratings.timeliness,
        carefulness: ratings.carefulness,
        communication: ratings.communication,
        tags,
      });
      if (tip && tip > 0) {
        await submitTip.mutateAsync({ booking_id: bookingId, amount_cents: tip * 100 });
      }
      haptic.success();
      onClose();
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message ?? 'Try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white" style={{ maxHeight: '92%' }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
            <View className="self-center h-1 w-12 rounded-full bg-silver-200 mb-4" />

            <View className="items-center">
              <Avatar name={moverName} size={64} />
              <Text className="mt-3 text-xl font-bold text-ink-900">How was {moverName}?</Text>
              <Text className="text-xs text-silver-500 mt-1">Your move is complete · rate to help future customers</Text>
              <View className="mt-4">
                <RatingStars value={overall} onChange={setOverall} size={36} />
              </View>
              <Text className="mt-2 text-sm text-silver-500">
                {overall === 0 ? 'Tap to rate' : ['Awful', 'Bad', 'OK', 'Good', 'Excellent'][overall - 1]}
              </Text>
            </View>

            <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              Categories
            </Text>
            <View className="rounded-2xl border border-silver-200 p-4 gap-3">
              {CATEGORIES.map((c) => (
                <View key={c.key} className="flex-row items-center justify-between">
                  <Text className="text-sm text-ink-900">{c.label}</Text>
                  <RatingStars
                    value={ratings[c.key] ?? 0}
                    onChange={(v) => setRatings((r) => ({ ...r, [c.key]: v }))}
                    size={20}
                  />
                </View>
              ))}
            </View>

            <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              What stood out?
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {COMPLIMENT_TAGS.map((t) => {
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

            <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              Add a tip · 90% to your crew
            </Text>
            <View className="flex-row gap-2">
              {[15, 18, 20, 25].map((pct) => {
                const amt = Math.max(1, Math.round((bookingTotalDollars * pct) / 100));
                const sel = tip === amt;
                return (
                  <Pressable
                    key={pct}
                    onPress={() => setTip(sel ? null : amt)}
                    className={`flex-1 rounded-2xl border px-2 py-3 items-center ${
                      sel ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-300'
                    }`}
                  >
                    <Text className={`text-base font-bold ${sel ? 'text-white' : 'text-ink-900'}`}>
                      {pct}%
                    </Text>
                    <Text className={`text-[11px] mt-0.5 ${sel ? 'text-white/80' : 'text-silver-500'}`}>
                      ${amt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setTip(null)} className="mt-3 self-center">
              <Text className="text-xs font-semibold text-silver-500">No tip</Text>
            </Pressable>

            <View className="mt-6 gap-2">
              <Button
                label="Submit rating"
                size="lg"
                fullWidth
                disabled={overall === 0}
                loading={submitRating.isPending || submitTip.isPending}
                onPress={submit}
              />
              <Pressable onPress={onClose} className="h-12 items-center justify-center">
                <Text className="text-sm text-silver-500">Maybe later</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
