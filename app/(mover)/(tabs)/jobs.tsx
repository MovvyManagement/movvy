import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { InviteAcceptHost } from '@/components/InviteAcceptHost';
import { NewJobOfferHost } from '@/components/NewJobOfferHost';
import { mockJobs } from '@/data/mockJobs';
import { withMockFallback } from '@/lib/mocks';
import { fmtCurrency, fmtDistance, fmtDuration, fmtTime, fmtDateShort } from '@/lib/format';
import { moveSummary } from '@/lib/moveSummary';
import { useAvailableJobs, useAcceptBooking, useMyMembership, useMyAssignedJobs, acceptOnBehalfOf } from '@/lib/data';
import { estimatePartnerPayoutCents, jobEffort, distanceToPickupKm } from '@/lib/partnerJobs';
import { useUserLocation } from '@/lib/useUserLocation';
import { supabase, supabaseConfigured, useAuth } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';
import { useQuery } from '@tanstack/react-query';
import { NotificationBell } from '@/components/NotificationBell';

// A company driver's shift reads as a day-grouped, time-ordered list, so the
// schedule needs a human day header. The assigned feed already arrives sorted
// by window-start ascending, so grouping by calendar day keeps it chronological.
function shiftDayLabel(iso: string | null | undefined): string {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return fmtDateShort(iso);
}

export default function MoverJobs() {
  // Partners are always online while the app is open (presence is set once in
  // the (mover) layout), so the feed is always live — no Online/Offline gate.
  const { data: membership } = useMyMembership();
  // Hourly laborers (company drivers + team movers) work a dispatched shift:
  // no open accept-feed, no payout — just the moves handed to them.
  const isHourly = membership?.is_hourly ?? false;

  // Hourly workers don't see the open feed — their dispatcher/operator assigns
  // jobs to them. They only see jobs already assigned to them personally.
  // City comes from the partner's primary_city_id so an Edmonton crew
  // sees Edmonton jobs, a Red Deer crew sees Red Deer jobs, etc. Falls
  // back to 'calgary' only when membership hasn't loaded yet (the query
  // gates on the slug so this just means "wait one tick").
  const { data: live, isLoading, refetch, isRefetching } = useAvailableJobs(
    membership?.city_slug ?? 'calgary',
  );
  const {
    data: assignedJobs,
    isLoading: assignedLoading,
    refetch: refetchAssigned,
    isRefetching: assignedRefetching,
  } = useMyAssignedJobs();
  const { user } = useAuth();
  const accept = useAcceptBooking();
  const prevCount = useRef(0);

  // Driver's GPS — powers the "X km away" (distance-to-pickup) signal on
  // open-pool cards. Null until permission resolves; the chip is just omitted.
  const userLoc = useUserLocation();

  // 4.2 EARNINGS — real today/week from driver_payouts (or fallback zero)
  const earnings = useQuery({
    queryKey: ['driver-earnings', user?.id],
    enabled: !!user && supabaseConfigured,
    queryFn: async () => {
      const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
      const startOfWeek = new Date(); startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7); startOfWeek.setUTCHours(0,0,0,0);
      const { data: paid } = await supabase
        .from('driver_payouts')
        .select('net_cents, created_at')
        .eq('driver_profile_id', user!.id)
        .gte('created_at', startOfWeek.toISOString());
      const todayCents = (paid ?? []).filter((r: any) => new Date(r.created_at) >= startOfToday).reduce((s: number, r: any) => s + (r.net_cents ?? 0), 0);
      const weekCents = (paid ?? []).reduce((s: number, r: any) => s + (r.net_cents ?? 0), 0);
      return { todayCents, weekCents };
    },
  });

  // 4.1 client-side hook: new job → haptic + light cue. Push happens server-side.
  useEffect(() => {
    if (live && live.length > prevCount.current && prevCount.current > 0) {
      haptic.success();
    }
    if (live) prevCount.current = live.length;
  }, [live?.length]);

  const onAccept = async (jobId: string) => {
    // bookings-accept requires the team/company you're accepting on behalf of —
    // solo / 2-person crews accept as their team, company owners/dispatchers as
    // their company. Without it the edge function rejects the call (400).
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
      'You\'ll be locked in and the customer will be notified. Make sure you can make it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          style: 'default',
          onPress: async () => {
            try {
              haptic.medium();
              await accept.mutateAsync({ booking_id: jobId, ...onBehalfOf });
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

  const jobs = useMemo(() => {
    if (live && live.length > 0) {
      return live.map((b) => ({
        id: b.id,
        moveType: b.move_type,
        payout: Math.round(estimatePartnerPayoutCents(b) / 100), // shared estimator — matches dashboard + job detail
        pickup: { line1: b.pickup_line1, city: b.pickup_city },
        dropoff: { line1: b.dropoff_line1 ?? 'in-home', city: b.dropoff_city ?? '' },
        scheduledFor: b.scheduled_for_window_starts_at ?? `${b.scheduled_for_date}T08:00:00Z`,
        distanceKm: b.distance_km ?? 0,
        durationMin: b.duration_min ?? 0,
        pickupLat: b.pickup_lat,
        pickupLng: b.pickup_lng,
        effortChips: jobEffort(b).chips,
        requiredTruckFt: (b as any).required_truck_ft ?? 0,
        requiredCrew: (b as any).required_crew ?? 2,
        myMaxTruckFt: (b as any).my_max_truck_ft ?? 0,
        itemsSummary:
          b.move_type === 'home_move'
            ? `${(b.details as any)?.bedrooms ?? 0}-bed ${(b.details as any)?.dwelling ?? 'home'}`
            : b.move_type.replace('_', ' '),
      }));
    }
    // Dev-only fallback — empty array in prod so the EmptyState UI shows
    // instead of fake jobs surfacing to a real driver.
    return withMockFallback<any>([], mockJobs);
  }, [live]);

  // ─── Hourly-laborer view — dispatcher-assigned jobs only ──────────────────
  // Company drivers AND team movers: no global accept feed, no Online/Offline
  // toggle (your company/operator manages your shift), and no per-move payout
  // (you're paid a wage). Just the moves your dispatcher has handed you.
  if (isHourly) {
    const myJobs = assignedJobs ?? [];
    // Group the (already time-sorted) assigned moves into day buckets so the
    // shift reads as "Today · 8:00 AM …, 1:30 PM …" then "Tomorrow · …".
    const dayGroups: { key: string; label: string; jobs: typeof myJobs }[] = [];
    for (const job of myJobs) {
      const iso = job.scheduled_for_window_starts_at;
      const key = iso ? new Date(iso).toDateString() : 'unscheduled';
      const existing = dayGroups.find((g) => g.key === key);
      if (existing) existing.jobs.push(job);
      else dayGroups.push({ key, label: shiftDayLabel(iso), jobs: [job] });
    }
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        {/* Invite-accept popup — fires the moment a signed-in driver has
            a pending invite matching their email/phone. The user must
            Accept or Decline before they can interact with the rest of
            the app. */}
        <InviteAcceptHost />
        <NewJobOfferHost />
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader
            title="My Jobs"
            subtitle={membership?.company_name ?? membership?.team_name ?? undefined}
            showBack={false}
            right={<NotificationBell href="/(mover)/notifications" />}
          />
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={assignedRefetching}
              onRefresh={() => refetchAssigned()}
              tintColor="#16A34A"
            />
          }
        >
          <View className="mb-4 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row">
            <Ionicons name="shield-checkmark" size={18} color="#047857" />
            <Text className="ml-2 flex-1 text-xs text-ink-700 leading-5">
              Your dispatcher assigns moves to you. You can't accept or
              decline from here — but you'll see every move you're on, and
              you can flag stops once you start (on-the-way, arrived, etc).
            </Text>
          </View>

          {assignedLoading ? (
            <View className="py-12 items-center">
              <ActivityIndicator color="#16A34A" />
            </View>
          ) : myJobs.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title="Nothing assigned yet"
              body="Your dispatcher will hand you moves as they come in. You'll get a notification the moment one lands."
            />
          ) : (
            <>
              {/* Time-ordered shift schedule — a company mover's day, grouped by
                  day and led by the start time (the "what's next, what time,
                  where"). No payout: company drivers may be hourly/salaried, so
                  per-move dollars are the wrong frame for them. */}
              {dayGroups.map((group) => (
                <View key={group.key} className="mb-2">
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                      {group.label}
                    </Text>
                    <Text className="text-xs text-silver-400">
                      {group.jobs.length} {group.jobs.length === 1 ? 'move' : 'moves'}
                    </Text>
                  </View>
                  {group.jobs.map((b) => {
                    const chips = jobEffort(b).chips;
                    return (
                      <View key={b.id} className="mb-3">
                        <Card onPress={() => router.push('/(mover)/(tabs)/active')}>
                          <View className="flex-row">
                            {/* Time column — the spine of a shift view. */}
                            <View
                              className="mr-3 pr-3 border-r border-silver-200"
                              style={{ width: 76 }}
                            >
                              <Text className="text-base font-bold text-ink-900">
                                {b.scheduled_for_window_starts_at
                                  ? fmtTime(b.scheduled_for_window_starts_at)
                                  : b.scheduled_for_window ?? 'All day'}
                              </Text>
                              <Text className="text-[11px] text-silver-500 mt-0.5">
                                {fmtDateShort(b.scheduled_for_date)}
                              </Text>
                              <Text className="text-[11px] font-semibold text-ink-700 mt-1">
                                {moveSummary(b)}
                              </Text>
                            </View>
                            <View className="flex-1">
                              <View className="flex-row items-start justify-between">
                                <Text
                                  className="flex-1 text-sm font-bold text-ink-900 mr-2"
                                  numberOfLines={1}
                                >
                                  {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                                </Text>
                                <Badge label={b.status.replace(/_/g, ' ')} tone="brand" />
                              </View>
                              <Text
                                className="text-xs text-silver-500 mt-0.5"
                                numberOfLines={1}
                              >
                                {b.pickup_city} · #{b.short_code}
                              </Text>
                              {chips.length > 0 ? (
                                <View className="mt-2 flex-row flex-wrap gap-1.5">
                                  {chips.map((c) => (
                                    <View
                                      key={c}
                                      className="px-2 py-0.5 rounded-full bg-silver-100"
                                    >
                                      <Text className="text-[10px] font-semibold text-ink-700">
                                        {c}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </Card>
                      </View>
                    );
                  })}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Solo / 2-person team view — original accept-feed ──────────────────────
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <InviteAcceptHost />
      <NewJobOfferHost />
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Available Jobs"
          showBack={false}
          right={<NotificationBell href="/(mover)/notifications" />}
        />
      </View>

      {isLoading && supabaseConfigured ? (
        // Card skeletons feel more responsive than a centred spinner — the
        // user immediately understands "list is loading" rather than
        // "screen is broken."
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={3} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#16A34A" />
          }
        >
          {jobs.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title="No jobs available right now"
              body="New moves appear here as customers book in your area — we'll ping you the second something comes in."
            />
          ) : (
            <>
              {/* Earnings widget — cold-state copy when the driver hasn't
                  completed any moves yet, full numbers + chart link once
                  they have. Avoids the deflating "$0 / $0" first impression. */}
              {((earnings.data?.todayCents ?? 0) + (earnings.data?.weekCents ?? 0)) === 0 ? (
                <Pressable
                  onPress={() => router.push('/(mover)/(tabs)/earnings')}
                  className="mb-4 rounded-3xl bg-ink-900 p-5 flex-row items-center active:opacity-90"
                >
                  <View className="h-10 w-10 rounded-2xl bg-white/10 items-center justify-center">
                    <Ionicons name="wallet-outline" size={20} color="#fff" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-bold text-white">
                      Earnings start with Move #1
                    </Text>
                    <Text className="text-[11px] text-white/70 mt-0.5 leading-4">
                      Accept your first job and your payouts will show up here.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#fff" />
                </Pressable>
              ) : (
                <View className="mb-4 rounded-3xl bg-ink-900 p-5 flex-row">
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold uppercase tracking-wider text-white/60">Today</Text>
                    <Text className="text-2xl font-bold text-white mt-1">
                      {fmtCurrency((earnings.data?.todayCents ?? 0) / 100)}
                    </Text>
                  </View>
                  <View className="w-px bg-white/10 mx-2" />
                  <View className="flex-1">
                    <Text className="text-[10px] font-bold uppercase tracking-wider text-white/60">This week</Text>
                    <Text className="text-2xl font-bold text-white mt-1">
                      {fmtCurrency((earnings.data?.weekCents ?? 0) / 100)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/(mover)/(tabs)/earnings')}
                    className="h-9 px-3 rounded-full bg-white/10 items-center justify-center flex-row self-center"
                  >
                    <Text className="text-xs font-bold text-white">Details</Text>
                    <Ionicons name="chevron-forward" size={14} color="#fff" />
                  </Pressable>
                </View>
              )}

              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
                Nearby ({jobs.length})
              </Text>
              {jobs.map((j) => (
                <View key={j.id} className="mb-3">
                  <Card onPress={() => router.push(`/(mover)/job/${j.id}`)}>
                    <View className="flex-row items-center justify-between">
                      <Badge label={j.moveType.replace('_', ' ')} tone="brand" />
                      <Text className="text-xl font-bold text-ink-900">{fmtCurrency(j.payout)}</Text>
                    </View>

                    <Text className="text-sm font-bold text-ink-900 mt-3">{j.itemsSummary}</Text>

                    <View className="mt-3 flex-row">
                      <View className="items-center mr-3">
                        <View className="h-3 w-3 rounded-full bg-ink-900" />
                        <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 18 }} />
                        <View className="h-3 w-3 rounded-full bg-brand-600" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm text-ink-900">{j.pickup.line1}</Text>
                        <Text className="text-xs text-silver-500 mb-2">{j.pickup.city}</Text>
                        <Text className="text-sm text-ink-900">{j.dropoff.line1}</Text>
                        <Text className="text-xs text-silver-500">{j.dropoff.city}</Text>
                      </View>
                    </View>

                    <View className="h-px bg-silver-200 my-3" />

                    {/* Accept-decision signal row — when it starts, how far to
                        drive just to reach pickup, the total route, and the
                        estimated on-road duration. */}
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 flex-1 mr-2">
                        <View className="flex-row items-center">
                          <Ionicons name="time-outline" size={14} color="#71717A" />
                          <Text className="ml-1 text-xs text-silver-500">{fmtTime(j.scheduledFor)}</Text>
                        </View>
                        {(() => {
                          const toPickupKm = distanceToPickupKm(userLoc, {
                            pickup_lat: j.pickupLat,
                            pickup_lng: j.pickupLng,
                          });
                          return toPickupKm != null ? (
                            <View className="flex-row items-center">
                              <Ionicons name="location-outline" size={14} color="#71717A" />
                              <Text className="ml-1 text-xs text-silver-500">
                                {fmtDistance(toPickupKm)} away
                              </Text>
                            </View>
                          ) : null;
                        })()}
                        {j.distanceKm > 0 ? (
                          <View className="flex-row items-center">
                            <Ionicons name="navigate-outline" size={14} color="#71717A" />
                            <Text className="ml-1 text-xs text-silver-500">{fmtDistance(j.distanceKm)}</Text>
                          </View>
                        ) : null}
                        {j.durationMin > 0 ? (
                          <View className="flex-row items-center">
                            <Ionicons name="hourglass-outline" size={14} color="#71717A" />
                            <Text className="ml-1 text-xs text-silver-500">{fmtDuration(j.durationMin)}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
                    </View>

                    {/* Effort chips — stairs / heavy items / packing etc. The
                        physical-effort heads-up the old card hid entirely. */}
                    {j.effortChips.length > 0 ? (
                      <View className="mt-3 flex-row flex-wrap gap-1.5">
                        {j.effortChips.map((c: string) => (
                          <View key={c} className="px-2 py-0.5 rounded-full bg-silver-100">
                            <Text className="text-[10px] font-semibold text-ink-700">{c}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* What this move needs — truck size + crew. Shown BEFORE
                        the Accept so nobody claims a job their truck can't
                        carry and finds out on move day. */}
                    <View className="mt-3 flex-row items-center">
                      <Ionicons name="cube-outline" size={14} color="#71717A" />
                      <Text className="ml-1.5 text-xs text-silver-600">
                        {j.requiredTruckFt > 0
                          ? `Needs ${j.requiredTruckFt} ft truck · ${j.requiredCrew} crew`
                          : `Needs ${j.requiredCrew} crew`}
                      </Text>
                    </View>

                    {/* 4.3 One-tap Accept — blocked when the truck won't fit. */}
                    {j.requiredTruckFt > 0 && j.myMaxTruckFt < j.requiredTruckFt ? (
                      <View className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 flex-row items-center">
                        <Ionicons name="alert-circle-outline" size={16} color="#B45309" />
                        <Text className="ml-2 flex-1 text-[11px] text-ink-900 leading-4">
                          {j.myMaxTruckFt > 0
                            ? `Your largest truck is ${j.myMaxTruckFt} ft — this move needs ${j.requiredTruckFt} ft.`
                            : 'Add your truck (with its registration) before accepting jobs.'}
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => onAccept(j.id)}
                        disabled={accept.isPending}
                        className={`mt-3 h-12 rounded-2xl items-center justify-center flex-row ${
                          accept.isPending ? 'bg-silver-200' : 'bg-brand-600 active:opacity-90'
                        }`}
                      >
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text className="ml-2 text-sm font-bold text-white">Accept this job</Text>
                      </Pressable>
                    )}
                  </Card>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
