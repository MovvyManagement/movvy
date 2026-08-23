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
import { fmtCurrency, fmtTime } from '@/lib/format';
import { jobUrgency, moveTotalCents } from '@/lib/partnerJobs';
import { useMyMembership, useCompanyDriverRoster, useCompanyJobs } from '@/lib/data';
import { NotificationBell } from '@/components/NotificationBell';
import { UrgencyPill } from '@/components/UrgencyPill';
import { EmptyState } from '@/components/EmptyState';

export default function CompanyDashboard() {
  // Live driver roster — drives the utilization tile + the "X idle" copy.
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const { data: roster } = useCompanyDriverRoster(companyId);

  // Real operating market for the header subtitle — derived from the company's
  // primary city instead of a hardcoded "Calgary, AB" (which was wrong for
  // every Edmonton / Red Deer / Lethbridge company). Undefined until membership
  // loads so we never flash a wrong city.
  const cityLabel = membership?.city_name
    ? `${membership.city_name}${membership.city_region ? `, ${membership.city_region}` : ''}`
    : undefined;

  const totalDrivers = roster?.length ?? 0;
  const onlineDrivers = roster?.filter((d) => d.is_online).length ?? 0;
  const busyDrivers = roster?.filter((d) => d.is_online && d.active_jobs > 0).length ?? 0;
  const idleDrivers = Math.max(0, onlineDrivers - busyDrivers);
  // Utilization = busy / online (only count drivers who are actually on shift).
  const utilization = onlineDrivers > 0 ? Math.round((busyDrivers / onlineDrivers) * 100) : 0;

  // Today's revenue — sum of company's completed bookings whose
  // completed_at falls today. Falls back to $0 when the company hasn't
  // completed a move yet, so the dashboard reflects reality on day one.
  const { data: jobs } = useCompanyJobs(companyId);
  const todayRevenueCents = (() => {
    if (!jobs) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return jobs
      .filter(
        (j) =>
          j.status === 'completed' &&
          new Date(j.created_at).getTime() >= startOfDay.getTime(),
      )
      // Completed jobs only, so the settled bill is what they earned — the
      // estimate is what the deposit was taken against, not revenue.
      .reduce((s, j) => s + moveTotalCents(j), 0);
  })();

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      {/* Invite-accept popup — fires for dispatcher invitees the moment
          they land on the dashboard with a pending invite. Drivers under
          this same company would land on (mover)/jobs instead, where the
          host is also mounted. */}
      <InviteAcceptHost />
      <NewJobOfferHost />
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title={membership?.company_name ?? 'Dashboard'}
          subtitle={cityLabel}
          showBack={false}
          right={<NotificationBell href="/(company)/notifications" />}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Today's revenue</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">
              {fmtCurrency(todayRevenueCents / 100)}
            </Text>
            <Text className="mt-2 text-xs text-silver-500">
              {todayRevenueCents > 0
                ? `From ${jobs?.filter((j) => j.status === 'completed').length ?? 0} completed today`
                : 'No completed moves today yet'}
            </Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Active drivers</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">
              {onlineDrivers}/{totalDrivers}
            </Text>
            <Text className="mt-2 text-xs text-silver-500">
              {busyDrivers} on jobs
            </Text>
          </Card>
        </View>

        {/* Utilization tile — busy/online drivers + idle headcount. The
            dispatcher uses this to spot capacity issues at a glance. */}
        <Card className="mt-3">
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="speedometer" size={22} color="#047857" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">
                Driver utilization
              </Text>
              <View className="flex-row items-baseline mt-0.5">
                <Text className="text-2xl font-bold text-ink-900">{utilization}%</Text>
                <Text className="ml-2 text-xs text-silver-500">
                  {idleDrivers} {idleDrivers === 1 ? 'driver' : 'drivers'} idle right now
                </Text>
              </View>
            </View>
          </View>
          {/* Mini progress bar — visual cue of how saturated the fleet is. */}
          <View className="mt-3 h-2 rounded-full bg-silver-100 overflow-hidden">
            <View
              className={`h-2 rounded-full ${
                utilization >= 85
                  ? 'bg-danger'
                  : utilization >= 60
                  ? 'bg-success'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, utilization)}%` }}
            />
          </View>
          <Text className="mt-2 text-[11px] text-silver-500">
            {utilization >= 85
              ? 'Capacity nearly full — consider activating reserve drivers.'
              : utilization >= 60
              ? 'Healthy load. Idle drivers are ready for incoming requests.'
              : utilization === 0 && onlineDrivers > 0
              ? 'No active assignments — all drivers waiting for dispatch.'
              : 'Plenty of headroom — push for more bookings or stand down drivers.'}
          </Text>
        </Card>

        {/* Per-driver utilization — fleet-wide percent is useful but hides
            uneven loads (one driver hammered, three idle). This breakdown
            sorts by active jobs desc so the dispatcher's eye lands on the
            ones nearing capacity. Offline drivers are grouped at the bottom
            so the on-shift cohort stays front and centre. */}
        {roster && roster.length > 0 ? (
          <View className="mt-3">
            <View className="flex-row items-center justify-between mb-2 px-1">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Per-driver load
              </Text>
              <Pressable onPress={() => router.push('/(company)/drivers')}>
                <Text className="text-xs font-semibold text-brand-700">Manage drivers</Text>
              </Pressable>
            </View>
            <Card padded={false}>
              {roster
                .slice()
                .sort((a, b) => {
                  // Online + busiest first so the heatmap reads top-down.
                  if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
                  if (a.active_jobs !== b.active_jobs) return b.active_jobs - a.active_jobs;
                  return (a.full_name ?? '').localeCompare(b.full_name ?? '');
                })
                .slice(0, 6)
                .map((d, i, arr) => {
                  // Treat 3+ active as "full" for the load bar — most drivers
                  // can run 2 same-day moves comfortably, 3 is the upper edge.
                  const FULL_LOAD = 3;
                  const pct = Math.min(100, (d.active_jobs / FULL_LOAD) * 100);
                  const barColor =
                    pct >= 100
                      ? '#EF4444'
                      : pct >= 66
                      ? '#F59E0B'
                      : pct > 0
                      ? '#16A34A'
                      : '#E4E4E7';
                  return (
                    <View
                      key={d.profile_id}
                      className={`px-5 py-3 ${
                        i < arr.length - 1 ? 'border-b border-silver-100' : ''
                      }`}
                    >
                      <View className="flex-row items-center">
                        <View
                          className={`h-2.5 w-2.5 rounded-full ${
                            d.is_online ? 'bg-brand-600' : 'bg-silver-300'
                          }`}
                        />
                        <Text className="ml-2 flex-1 text-sm font-semibold text-ink-900" numberOfLines={1}>
                          {d.full_name ?? '—'}
                        </Text>
                        <Text className="text-xs text-silver-500">
                          {d.is_online
                            ? `${d.active_jobs} active`
                            : 'Offline'}
                        </Text>
                      </View>
                      {/* Mini load bar */}
                      <View className="mt-1.5 h-1.5 rounded-full bg-silver-100 overflow-hidden">
                        <View
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                          className="h-1.5 rounded-full"
                        />
                      </View>
                    </View>
                  );
                })}
              {roster.length > 6 ? (
                <Pressable
                  onPress={() => router.push('/(company)/drivers')}
                  className="px-5 py-3 border-t border-silver-100 flex-row items-center justify-center active:opacity-70"
                >
                  <Text className="text-xs font-semibold text-brand-700">
                    See all {roster.length} drivers
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#047857" />
                </Pressable>
              ) : null}
            </Card>
          </View>
        ) : null}

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-3">
          Live operations
        </Text>
        {/* Real roster — was previously hardcoded "Marcus Lee / Priya Sandhu /
            Diego Alvarez" mock rows that an owner would see on their own
            dashboard. Now reads from useCompanyDriverRoster. */}
        {roster && roster.length > 0 ? (
          <Card>
            {roster.slice(0, 4).map((d, i, arr) => {
              const onJob = d.is_online && d.active_jobs > 0;
              const label = onJob ? 'On job' : d.is_online ? 'Online' : 'Offline';
              const dotClass = onJob
                ? 'bg-warning'
                : d.is_online
                ? 'bg-success'
                : 'bg-silver-300';
              const tone: 'warning' | 'success' | 'neutral' = onJob
                ? 'warning'
                : d.is_online
                ? 'success'
                : 'neutral';
              return (
                <View
                  key={d.profile_id}
                  className={`flex-row items-center py-3 ${
                    i < arr.length - 1 ? 'border-b border-silver-100' : ''
                  }`}
                >
                  <View className={`h-3 w-3 rounded-full ${dotClass}`} />
                  <Text className="ml-3 flex-1 text-sm font-bold text-ink-900" numberOfLines={1}>
                    {d.full_name ?? '—'}
                  </Text>
                  <Badge label={label} tone={tone} />
                </View>
              );
            })}
          </Card>
        ) : (
          <Card>
            <Text className="text-sm font-semibold text-ink-900">No drivers on your roster yet</Text>
            <Text className="text-xs text-silver-500 mt-1 leading-4">
              Invite drivers from the Company tab → Drivers, and they'll appear here.
            </Text>
          </Card>
        )}

        {/* Incoming jobs — real list of bookings the dispatcher still needs to
            action (accepted into the company but no driver yet). Was a static
            mockJobs.map; now reads useCompanyJobs and routes both buttons to
            Dispatch where the actual accept/assign happens. */}
        <View className="mt-6 flex-row items-center justify-between mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            Incoming jobs
          </Text>
          <Pressable onPress={() => router.push('/(company)/(tabs)/jobs')}>
            <Text className="text-sm font-semibold text-brand-700">See all</Text>
          </Pressable>
        </View>
        {(() => {
          const incoming = (jobs ?? [])
            .filter((j) => j.status === 'assigned' && !j.assigned_driver_profile_id)
            .slice(0, 4);
          if (incoming.length === 0) {
            return (
              <Card>
                <Text className="text-sm font-semibold text-ink-900">
                  No bookings waiting for a driver
                </Text>
                <Text className="text-xs text-silver-500 mt-1 leading-4">
                  When you accept a new request on the Jobs tab, it'll show
                  here until you assign a driver.
                </Text>
              </Card>
            );
          }
          return incoming.map((j) => (
            <View key={j.id} className="mb-3">
              <Card>
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-wrap gap-2 flex-1 mr-2">
                    <Badge label={j.move_type.replace(/_/g, ' ')} tone="brand" />
                    {/* Same red/amber urgency the Jobs tab shows, so the
                        at-a-glance home flags which job is on fire. */}
                    <UrgencyPill urgency={jobUrgency(j.scheduled_for_window_starts_at)} />
                  </View>
                  <Text className="text-lg font-bold text-ink-900">
                    {fmtCurrency(moveTotalCents(j) / 100)}
                  </Text>
                </View>
                <Text className="text-sm font-bold text-ink-900 mt-3" numberOfLines={1}>
                  {j.pickup_line1} → {j.dropoff_line1 ?? 'In-home'}
                </Text>
                <Text className="text-xs text-silver-500 mt-1">
                  {j.pickup_city}
                  {j.scheduled_for_window_starts_at
                    ? ` · ${fmtTime(j.scheduled_for_window_starts_at)}`
                    : j.scheduled_for_window
                    ? ` · ${j.scheduled_for_window}`
                    : ''}
                </Text>
                <View className="mt-3 flex-row gap-2">
                  {/* Both buttons route to Dispatch — the real accept/assign
                      surface. Wiring the assign-driver flow directly here would
                      duplicate the driver-picker; Dispatch is the single source
                      of truth and lets the dispatcher pick from the live roster. */}
                  <Pressable
                    onPress={() => router.push('/(company)/(tabs)/jobs')}
                    className="flex-1 h-10 rounded-2xl bg-silver-100 items-center justify-center active:opacity-70"
                  >
                    <Text className="text-sm font-semibold text-ink-900">Assign driver</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/(company)/(tabs)/jobs')}
                    className="flex-1 h-10 rounded-2xl bg-brand-600 items-center justify-center active:opacity-90"
                  >
                    <Text className="text-sm font-semibold text-white">Open in Jobs</Text>
                  </Pressable>
                </View>
              </Card>
            </View>
          ));
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}
