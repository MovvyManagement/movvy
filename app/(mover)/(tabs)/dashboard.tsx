import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { InviteAcceptHost } from '@/components/InviteAcceptHost';
import { NewJobOfferHost } from '@/components/NewJobOfferHost';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { fmtCurrency, fmtTime, fmtDistance, fmtDuration } from '@/lib/format';
import { estimatePartnerPayoutCents, jobEffort, distanceToPickupKm } from '@/lib/partnerJobs';
import {
  useProfile,
  useMyMembership,
  useMyAssignedJobs,
  useAvailableJobs,
  useDriverEarningsSummary,
} from '@/lib/data';
import { useMyDriverStats } from '@/lib/data/usePartners';
import { useUserLocation } from '@/lib/useUserLocation';
import { NotificationBell } from '@/components/NotificationBell';

// =============================================================================
// /(mover)/(tabs)/dashboard — the driver's home.
//
// Two audiences share this screen, and they live in OPPOSITE economic
// realities, so the screen branches hard:
//   • Operators — a solo/2-person team's DRIVER (independent contractor) or a
//     company owner/dispatcher. They see their earnings (today/this week) and a
//     preview of the OPEN job pool with the signals they need to accept-or-skip
//     (payout, distance to pickup, route, duration, stairs/heavy items).
//   • Hourly laborers — company DRIVERS and team MOVERS on a dispatcher-run
//     shift. They're paid a wage, not per move, so we DON'T show per-move payout
//     or contractor earnings framing. Instead they get their shift: how many
//     moves today, what's next, and a time-ordered schedule.
//
// Partners are always online (presence is set in the (mover) layout), so
// there's no Online/Offline toggle — and the status tile no longer just says
// "You're online" (forced presence made that decoration). It now surfaces the
// move underway, or the next scheduled one.
// =============================================================================

// Statuses that mean a move is actively underway (vs. merely assigned/queued).
const IN_FLIGHT_STATUSES = ['on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'];

/** Small icon + label pair used for the accept-decision signal row. */
function MetaItem({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View className="flex-row items-center">
      <Ionicons name={icon} size={14} color="#71717A" />
      <Text className="ml-1 text-xs text-silver-500">{text}</Text>
    </View>
  );
}

export default function MoverDashboard() {
  const { data: profile } = useProfile();
  const { data: membership } = useMyMembership();
  // Hourly laborers (company drivers + team movers) work a dispatched shift:
  // no per-move payout, no contractor earnings — just their schedule.
  const isHourly = membership?.is_hourly ?? false;

  const { data: assignedJobs } = useMyAssignedJobs();
  const { data: live } = useAvailableJobs(membership?.city_slug ?? 'calgary');
  const { data: earnings } = useDriverEarningsSummary();
  const { data: stats } = useMyDriverStats();

  // Driver's GPS — powers the "X km away" signal on open-pool cards. Null until
  // permission resolves; cards simply omit the chip in that case.
  const userLoc = useUserLocation();

  const firstName = (profile?.full_name ?? 'Driver').split(' ')[0];
  const ratingText = stats?.rating_avg != null ? Number(stats.rating_avg).toFixed(1) : '—';
  const tripCount = stats?.trip_count ?? 0;
  const reviewCount = stats?.rating_count ?? 0;

  const todayCents = earnings?.todayCents ?? 0;
  const weekCents = earnings?.weekCents ?? 0;

  // Split the assigned list (ordered by window-start asc) into the move that's
  // actually underway vs. what's still queued. assignedJobs[0] isn't reliably
  // the in-flight one — a future 'assigned' move sorts ahead when nothing has
  // started yet, which made the old "Active move" tile lie.
  const inFlightJob =
    (assignedJobs ?? []).find((j) => IN_FLIGHT_STATUSES.includes(j.status)) ?? null;
  const upcomingJobs = (assignedJobs ?? []).filter((j) => j.id !== inFlightJob?.id);
  const nextScheduledJob = upcomingJobs[0] ?? null;

  // Company-driver shift figures — counts + times, never dollars.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const todaysMoveCount = (assignedJobs ?? []).filter((j) => {
    const iso = j.scheduled_for_window_starts_at;
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= startOfToday.getTime() && t < endOfToday.getTime();
  }).length;
  const nextMoveLabel = inFlightJob
    ? 'Now'
    : nextScheduledJob?.scheduled_for_window_starts_at
    ? fmtTime(nextScheduledJob.scheduled_for_window_starts_at)
    : '—';

  // Open-pool preview (solo only). Time-ordered shift preview (company only).
  const openPreview = (live ?? []).slice(0, 3);
  const shiftPreview = (assignedJobs ?? []).slice(0, 4);

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      {/* Same hosts the company dashboard + old Jobs landing mounted — a
          driver who lands here with a pending invite still gets prompted, and
          live job-offer popups still fire. */}
      <InviteAcceptHost />
      <NewJobOfferHost />
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title={`Hi, ${firstName}`}
          subtitle={
            membership?.team_name ?? membership?.company_name ?? membership?.city_name ?? undefined
          }
          showBack={false}
          right={<NotificationBell href="/(mover)/notifications" />}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Headline stats — branches on audience. Company drivers get their
            shift at a glance (moves today + next move time); solo/team drivers
            get their contractor earnings. */}
        {isHourly ? (
          <View className="flex-row gap-3">
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Today</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{todaysMoveCount}</Text>
              <Text className="mt-2 text-xs text-silver-500">
                {todaysMoveCount === 1 ? 'move on your shift' : 'moves on your shift'}
              </Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Next move</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{nextMoveLabel}</Text>
              <Text className="mt-2 text-xs text-silver-500">
                {inFlightJob
                  ? 'In progress'
                  : nextScheduledJob
                  ? 'Scheduled start'
                  : 'Nothing scheduled'}
              </Text>
            </Card>
          </View>
        ) : (
          <View className="flex-row gap-3">
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Today</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency(todayCents / 100)}
              </Text>
              <Text className="mt-2 text-xs text-silver-500">
                {todayCents > 0 ? 'Paid out today' : 'No payouts yet today'}
              </Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">This week</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency(weekCents / 100)}
              </Text>
              <Pressable onPress={() => router.push('/(mover)/earnings')} className="mt-2">
                <Text className="text-xs font-semibold text-brand-700">View earnings →</Text>
              </Pressable>
            </Card>
          </View>
        )}

        {/* Status tile — now load-bearing instead of decoration. Shows the move
            underway, else the next scheduled move (time + where), else the
            right idle nudge. */}
        {inFlightJob ? (
          <Card className="mt-3" onPress={() => router.push('/(mover)/active')}>
            <View className="flex-row items-center">
              <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
                <Ionicons name="navigate-circle" size={22} color="#047857" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-xs text-silver-500 uppercase font-semibold">Active move</Text>
                <Text className="text-sm font-bold text-ink-900 mt-0.5" numberOfLines={1}>
                  {inFlightJob.pickup_line1} → {inFlightJob.dropoff_line1 ?? 'in-home'}
                </Text>
                <Text className="text-xs text-silver-500 mt-0.5">
                  #{inFlightJob.short_code} · {inFlightJob.status.replace(/_/g, ' ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
            </View>
          </Card>
        ) : nextScheduledJob ? (
          <Card
            className="mt-3"
            onPress={() =>
              router.push(
                (isHourly
                  ? '/(mover)/active'
                  : `/(mover)/job/${nextScheduledJob.id}`) as any,
              )
            }
          >
            <View className="flex-row items-center">
              <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
                <Ionicons name="time" size={22} color="#047857" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-xs text-silver-500 uppercase font-semibold">Next up</Text>
                <Text className="text-sm font-bold text-ink-900 mt-0.5" numberOfLines={1}>
                  {nextScheduledJob.pickup_line1} → {nextScheduledJob.dropoff_line1 ?? 'in-home'}
                </Text>
                <Text className="text-xs text-silver-500 mt-0.5">
                  {nextScheduledJob.scheduled_for_window_starts_at
                    ? fmtTime(nextScheduledJob.scheduled_for_window_starts_at)
                    : nextScheduledJob.scheduled_for_window ?? 'Time TBD'}
                  {' · '}
                  {nextScheduledJob.pickup_city}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
            </View>
          </Card>
        ) : (
          <Card className="mt-3">
            <View className="flex-row items-center">
              <View className="h-12 w-12 rounded-2xl bg-silver-100 items-center justify-center">
                <Ionicons
                  name={isHourly ? 'shield-checkmark' : 'radio'}
                  size={22}
                  color="#71717A"
                />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">
                  {isHourly ? 'No moves scheduled' : "You're online"}
                </Text>
                <Text className="text-xs text-silver-500 mt-0.5 leading-4">
                  {isHourly
                    ? 'Your dispatcher will assign your next move — it lands here the moment it does.'
                    : 'Waiting for moves in your area. New jobs show below the moment they come in.'}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Performance — the driver's own rating/trip count. */}
        <Card className="mt-3">
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="star" size={22} color="#16A34A" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Your rating</Text>
              <View className="flex-row items-baseline mt-0.5">
                <Text className="text-2xl font-bold text-ink-900">{ratingText}</Text>
                <Text className="ml-2 text-xs text-silver-500">
                  {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'} · {tripCount} completed
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Bottom section — branches on audience. Company drivers get a
            time-ordered shift schedule (no payout); solo drivers get an
            open-pool preview rich enough to make the accept call. */}
        <View className="mt-6 flex-row items-center justify-between mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            {isHourly ? 'Your shift' : 'Available jobs'}
          </Text>
          <Pressable onPress={() => router.push('/(mover)/jobs')}>
            <Text className="text-sm font-semibold text-brand-700">See all</Text>
          </Pressable>
        </View>

        {isHourly ? (
          shiftPreview.length === 0 ? (
            <Card>
              <Text className="text-sm font-semibold text-ink-900">Nothing assigned yet</Text>
              <Text className="text-xs text-silver-500 mt-1 leading-4">
                Your dispatcher hands you moves as they come in — you'll get a notification the
                moment one lands.
              </Text>
            </Card>
          ) : (
            shiftPreview.map((b) => (
              <View key={b.id} className="mb-3">
                <Card onPress={() => router.push('/(mover)/active')}>
                  <View className="flex-row items-center">
                    {/* Time column — the spine of a shift view. */}
                    <View className="items-center mr-3" style={{ width: 60 }}>
                      <Text className="text-sm font-bold text-ink-900">
                        {b.scheduled_for_window_starts_at
                          ? fmtTime(b.scheduled_for_window_starts_at)
                          : 'TBD'}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-ink-900" numberOfLines={1}>
                        {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                      </Text>
                      <Text className="text-xs text-silver-500 mt-0.5" numberOfLines={1}>
                        {b.pickup_city} · #{b.short_code}
                      </Text>
                    </View>
                    <Badge label={b.status.replace(/_/g, ' ')} tone="brand" />
                  </View>
                </Card>
              </View>
            ))
          )
        ) : openPreview.length === 0 ? (
          <Card>
            <Text className="text-sm font-semibold text-ink-900">No jobs available right now</Text>
            <Text className="text-xs text-silver-500 mt-1 leading-4">
              New moves appear here as customers book in your area — we ping you the second
              something comes in.
            </Text>
          </Card>
        ) : (
          openPreview.map((b) => {
            const payoutCents = estimatePartnerPayoutCents(b);
            const toPickupKm = distanceToPickupKm(userLoc, b);
            const effort = jobEffort(b);
            return (
              <View key={b.id} className="mb-3">
                <Card onPress={() => router.push(`/(mover)/job/${b.id}` as any)}>
                  <View className="flex-row items-center justify-between">
                    <Badge label={b.move_type.replace(/_/g, ' ')} tone="brand" />
                    <Text className="text-lg font-bold text-ink-900">
                      {fmtCurrency(payoutCents / 100)}
                    </Text>
                  </View>
                  <Text className="text-sm font-bold text-ink-900 mt-3" numberOfLines={1}>
                    {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                  </Text>
                  <Text className="text-xs text-silver-500 mt-1">{b.pickup_city}</Text>

                  {/* Accept-decision signal row — the numbers a driver weighs
                      before tapping in: when it starts, how far to drive just to
                      reach pickup, the total route, and the estimated duration. */}
                  <View className="mt-3 flex-row flex-wrap items-center gap-x-3 gap-y-1">
                    {b.scheduled_for_window_starts_at ? (
                      <MetaItem icon="time-outline" text={fmtTime(b.scheduled_for_window_starts_at)} />
                    ) : null}
                    {toPickupKm != null ? (
                      <MetaItem icon="location-outline" text={`${fmtDistance(toPickupKm)} away`} />
                    ) : null}
                    {b.distance_km ? (
                      <MetaItem icon="navigate-outline" text={fmtDistance(b.distance_km)} />
                    ) : null}
                    {b.duration_min ? (
                      <MetaItem icon="hourglass-outline" text={fmtDuration(b.duration_min)} />
                    ) : null}
                  </View>

                  {/* Effort chips — stairs / heavy items / packing etc. The
                      physical-effort heads-up the old card hid entirely. */}
                  {effort.chips.length > 0 ? (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                      {effort.chips.map((c) => (
                        <View key={c} className="px-2 py-0.5 rounded-full bg-silver-100">
                          <Text className="text-[10px] font-semibold text-ink-700">{c}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View className="mt-3 flex-row items-center justify-end">
                    <Text className="text-xs font-semibold text-brand-700">View details</Text>
                    <Ionicons name="chevron-forward" size={14} color="#047857" />
                  </View>
                </Card>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
