// =============================================================================
// /(company)/(tabs)/jobs — unified company workflow.
//
// Merges what used to be two separate tabs (Dispatch + Jobs) into one
// screen so the dispatcher only ever has one place to act. Four chips:
//
//   • Requests     — new bookings in our city the dispatcher hasn't
//                    accepted/declined yet. Accept pulls them into the
//                    company queue; Decline records a signal so the
//                    matcher learns we're not interested.
//   • Needs Driver — accepted bookings with no driver assigned yet.
//                    Assign opens the driver picker; Release puts the
//                    booking back into the public pool.
//   • In Progress  — assigned bookings currently in-flight (confirmed →
//                    unloading). Read-only here; the driver's Active
//                    screen drives the status flags.
//   • Completed    — finished moves, kept for record-keeping + receipts.
//
// Drivers under the company never reach this surface — the layout hides
// the whole tab for role='driver'. Defence-in-depth render-time guard
// below stops a stale deep-link from landing them here anyway.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { NotificationBell } from '@/components/NotificationBell';
import { DispatcherPingSheet } from '@/components/DispatcherPingSheet';
import { UrgencyPill } from '@/components/UrgencyPill';
import {
  useMyMembership,
  useCompanyJobs,
  useDispatchQueue,
  useCompanyDriverRoster,
  useDispatcherAccept,
  useDispatcherDecline,
  useDispatcherAssign,
  type DispatchQueueRow,
  type CompanyDriverRosterRow,
} from '@/lib/data';
import { fmtCurrency, fmtDateShort, fmtRelativeAgo } from '@/lib/format';
import { jobUrgency } from '@/lib/partnerJobs';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';

const TABS = ['Requests', 'Needs Driver', 'In Progress', 'Completed'] as const;
type Tab = (typeof TABS)[number];

const IN_FLIGHT = ['confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'];

export default function CompanyJobs() {
  const [tab, setTab] = useState<Tab>('Requests');
  const { data: membership, isLoading: memLoading } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const isDispatcher =
    membership?.kind === 'company' &&
    membership.org_role === 'admin';

  // Dispatch queue — drives Requests + Needs Driver. Already polled +
  // realtime-subscribed inside the hook.
  const {
    data: queue,
    isLoading: queueLoading,
    refetch: refetchQueue,
    isRefetching: queueRefetching,
  } = useDispatchQueue(companyId);

  // Company-wide jobs — drives In Progress + Completed.
  const {
    data: rows,
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isRefetching: jobsRefetching,
  } = useCompanyJobs(companyId);

  const accept = useDispatcherAccept();
  const decline = useDispatcherDecline();
  const assign = useDispatcherAssign();

  // Realtime hook for the dispatch queue — when a new searching booking
  // lands or one of our accepted bookings changes (driver assigned,
  // customer cancels, etc.) we refresh within ~100 ms. The 8s polling
  // baked into useDispatchQueue is the safety net.
  const qc = useQueryClient();
  useEffect(() => {
    if (!companyId || !supabaseConfigured) return;
    // Unique per-mount channel name — supabase-js caches by topic, and the
    // same name reused after StrictMode's unmount/remount throws "cannot
    // add postgres_changes callbacks after subscribe()".
    const channel = supabase
      .channel(`company-jobs-queue:${companyId}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          const isOurs = row?.assigned_company_id === companyId;
          const isPotentialRequest = row?.status === 'searching';
          if (isOurs || isPotentialRequest) {
            qc.invalidateQueries({ queryKey: ['dispatch-queue', companyId] });
            qc.invalidateQueries({ queryKey: ['company-jobs', companyId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, qc]);

  const [assignTarget, setAssignTarget] = useState<DispatchQueueRow | null>(null);

  // Split the queue into the two action buckets up front so the counts on
  // the chips are correct even when a tab isn't visible.
  const newRequests = useMemo(
    () => (queue ?? []).filter((b) => b.bucket === 'new_request'),
    [queue],
  );
  const needsDriver = useMemo(
    () => (queue ?? []).filter((b) => b.bucket === 'needs_driver'),
    [queue],
  );
  const inProgress = useMemo(
    () => (rows ?? []).filter((r) => IN_FLIGHT.includes(r.status)),
    [rows],
  );
  const completed = useMemo(
    () => (rows ?? []).filter((r) => r.status === 'completed'),
    [rows],
  );

  const counts: Record<Tab, number> = {
    Requests: newRequests.length,
    'Needs Driver': needsDriver.length,
    'In Progress': inProgress.length,
    Completed: completed.length,
  };

  // ── Render guards ──────────────────────────────────────────────────────
  if (memLoading) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#16A34A" />
        </View>
      </SafeAreaView>
    );
  }

  if (!supabaseConfigured) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Jobs" showBack={false} right={<NotificationBell href="/(company)/notifications" />} />
        </View>
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase in .env.local to load your live jobs feed."
        />
      </SafeAreaView>
    );
  }

  if (!membership || membership.kind !== 'company') {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Jobs" showBack={false} right={<NotificationBell href="/(company)/notifications" />} />
        </View>
        <EmptyState
          icon="lock-closed-outline"
          title="Jobs is company-only"
          body="You need to be part of a Movvy company to manage incoming requests."
        />
      </SafeAreaView>
    );
  }

  if (!isDispatcher) {
    // Company drivers can still see what they're on — but the action
    // surface (accept / assign) doesn't apply to them.
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Jobs" showBack={false} right={<NotificationBell href="/(company)/notifications" />} />
        </View>
        <EmptyState
          icon="shield-checkmark-outline"
          title="Your dispatcher handles this"
          body="Drivers don't accept or assign jobs directly — your dispatcher does. Open the Active tab to see what you're on."
        />
      </SafeAreaView>
    );
  }

  // ── Main content per tab ───────────────────────────────────────────────
  const renderList = () => {
    if (tab === 'Requests') {
      if (queueLoading && !queue) return <CardSkeleton count={3} />;
      if (newRequests.length === 0) {
        return (
          <EmptyState
            icon="cube-outline"
            title="No pending requests"
            body="New bookings in your city land here within a second of the customer tapping Book."
          />
        );
      }
      return newRequests.map((b) => (
        <NewRequestCard
          key={b.id}
          row={b}
          busy={accept.isPending || decline.isPending}
          onAccept={async () => {
            try {
              await accept.mutateAsync({ booking_id: b.id, company_id: companyId! });
              haptic.success();
            } catch (e: any) {
              Alert.alert('Could not accept', e?.message ?? 'Try again.');
            }
          }}
          onDecline={async () => {
            try {
              await decline.mutateAsync({ booking_id: b.id, company_id: companyId! });
            } catch (e: any) {
              Alert.alert('Could not decline', e?.message ?? 'Try again.');
            }
          }}
        />
      ));
    }

    if (tab === 'Needs Driver') {
      if (queueLoading && !queue) return <CardSkeleton count={3} />;
      if (needsDriver.length === 0) {
        return (
          <EmptyState
            icon="people-outline"
            title="Nothing awaiting a driver"
            body="Bookings you accept above show up here until you pick a driver from your roster."
          />
        );
      }
      return needsDriver.map((b) => (
        <NeedsDriverCard
          key={b.id}
          row={b}
          busy={decline.isPending}
          onAssign={() => setAssignTarget(b)}
          onRelease={async () => {
            try {
              const res = await decline.mutateAsync({ booking_id: b.id, company_id: companyId! });
              if (res.action === 'released') haptic.warning();
            } catch (e: any) {
              Alert.alert('Could not release', e?.message ?? 'Try again.');
            }
          }}
        />
      ));
    }

    if (tab === 'In Progress') {
      if (jobsLoading && !rows) return <CardSkeleton count={3} />;
      if (inProgress.length === 0) {
        return (
          <EmptyState
            icon="navigate-outline"
            title="Nothing in progress right now"
            body="In-flight moves your fleet is on will show here. Status updates flow live from the driver's Active screen."
          />
        );
      }
      return inProgress.map((j) => <SummaryCard key={j.id} row={j} />);
    }

    // Completed
    if (jobsLoading && !rows) return <CardSkeleton count={3} />;
    if (completed.length === 0) {
      return (
        <EmptyState
          icon="checkmark-done-outline"
          title="No completed moves yet"
          body="Finished moves stay here for record-keeping and receipts."
        />
      );
    }
    return completed.map((j) => <SummaryCard key={j.id} row={j} />);
  };

  // Either source can drive refresh — pulling refreshes both so chip
  // counts and visible cards stay in sync.
  const isRefetching =
    tab === 'Requests' || tab === 'Needs Driver' ? queueRefetching : jobsRefetching;
  const onRefresh = async () => {
    await Promise.all([refetchQueue(), refetchJobs()]);
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Jobs"
          subtitle={membership.company_name ?? undefined}
          showBack={false}
          right={<NotificationBell href="/(company)/notifications" />}
        />
        {/* 4-chip tab bar — horizontally scrollable so labels with counts
            never compress on smaller phones. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 14, gap: 8 }}
        >
          {TABS.map((t) => (
            <Chip
              key={t}
              label={`${t} · ${counts[t]}`}
              selected={tab === t}
              onPress={() => setTab(t)}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor="#16A34A"
          />
        }
      >
        {renderList()}
      </ScrollView>

      {/* Assign-driver modal — same component the old Dispatch screen
          used. Opens from any Needs Driver card. */}
      <AssignDriverModal
        target={assignTarget}
        companyId={companyId!}
        busy={assign.isPending}
        onClose={() => setAssignTarget(null)}
        onAssign={async (driverProfileId) => {
          if (!assignTarget) return;
          try {
            await assign.mutateAsync({
              booking_id: assignTarget.id,
              company_id: companyId!,
              driver_profile_id: driverProfileId,
            });
            haptic.success();
            setAssignTarget(null);
          } catch (e: any) {
            Alert.alert('Could not assign', e?.message ?? 'Try again.');
          }
        }}
      />
    </SafeAreaView>
  );
}

// ─── Cards ──────────────────────────────────────────────────────────────────

function NewRequestCard({
  row,
  busy,
  onAccept,
  onDecline,
}: {
  row: DispatchQueueRow;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View className="mb-3">
      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase text-silver-500">
            {row.move_type.replace(/_/g, ' ')}
          </Text>
          <Text className="text-sm font-bold text-ink-900">
            {fmtCurrency(row.price_total_cents / 100)}
          </Text>
        </View>
        <RouteBlock row={row} />
        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={14} color="#71717A" />
            <Text className="ml-1 text-xs text-silver-500">
              {fmtDateShort(row.scheduled_for_date)}
              {row.scheduled_for_window ? ` · ${row.scheduled_for_window}` : ''}
            </Text>
          </View>
          <Text className="text-xs text-silver-500">#{row.short_code}</Text>
        </View>
        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={onDecline}
            disabled={busy}
            className="flex-1 h-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
          >
            <Text className="text-sm font-bold text-ink-900">Decline</Text>
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            className={`flex-[2] h-12 rounded-2xl items-center justify-center ${
              busy ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-bold text-white">Accept for company</Text>
            )}
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

function NeedsDriverCard({
  row,
  busy,
  onAssign,
  onRelease,
}: {
  row: DispatchQueueRow;
  busy: boolean;
  onAssign: () => void;
  onRelease: () => void;
}) {
  // Urgency pill — shared with the dashboard's incoming list via jobUrgency so
  // both surfaces agree on which job is "on fire" (red ≤6h / amber ≤24h).
  const urgency = jobUrgency(row.scheduled_for_window_starts_at);

  return (
    <View className="mb-3">
      <Card className="border-amber-200 bg-amber-50/40">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-wrap gap-2">
            <Badge label="Awaiting driver" tone="warning" />
            <UrgencyPill urgency={urgency} />
          </View>
          <Text className="text-sm font-bold text-ink-900">
            {fmtCurrency(row.price_total_cents / 100)}
          </Text>
        </View>
        <RouteBlock row={row} />
        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={14} color="#71717A" />
            <Text className="ml-1 text-xs text-silver-500">
              {fmtDateShort(row.scheduled_for_date)}
              {row.scheduled_for_window ? ` · ${row.scheduled_for_window}` : ''}
            </Text>
          </View>
          <Text className="text-xs text-silver-500">#{row.short_code}</Text>
        </View>
        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={onRelease}
            disabled={busy}
            className="flex-1 h-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
          >
            <Text className="text-sm font-bold text-ink-900">Release</Text>
          </Pressable>
          <Pressable
            onPress={onAssign}
            className="flex-[2] h-12 rounded-2xl bg-brand-600 items-center justify-center active:opacity-90"
          >
            <Text className="text-sm font-bold text-white">Assign driver</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

function SummaryCard({ row }: { row: any }) {
  return (
    <View className="mb-3">
      <Card>
        <View className="flex-row items-center justify-between">
          <Badge label={row.status.replace(/_/g, ' ')} tone={statusTone(row.status)} />
          <Text className="text-lg font-bold text-ink-900">
            {fmtCurrency(row.price_total_cents / 100)}
          </Text>
        </View>

        <View className="mt-3 flex-row">
          <View className="items-center mr-3">
            <View className="h-3 w-3 rounded-full bg-ink-900" />
            <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 18 }} />
            <View className="h-3 w-3 rounded-full bg-brand-600" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
              {row.pickup_line1}
            </Text>
            <Text className="text-xs text-silver-500 mb-2">{row.pickup_city}</Text>
            <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
              {row.dropoff_line1 ?? 'In-home'}
            </Text>
            <Text className="text-xs text-silver-500">{row.dropoff_city ?? ''}</Text>
          </View>
        </View>

        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={14} color="#71717A" />
            <Text className="ml-1 text-xs text-silver-500">
              {fmtDateShort(row.scheduled_for_date)}
              {row.scheduled_for_window ? ` · ${row.scheduled_for_window}` : ''}
            </Text>
          </View>
          <Text className="text-xs text-silver-500">#{row.short_code}</Text>
        </View>
      </Card>
    </View>
  );
}

function RouteBlock({ row }: { row: DispatchQueueRow }) {
  return (
    <View className="mt-3 flex-row">
      <View className="items-center mr-3">
        <View className="h-3 w-3 rounded-full bg-ink-900" />
        <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 18 }} />
        <View className="h-3 w-3 rounded-full bg-brand-600" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
          {row.pickup_line1}
        </Text>
        <Text className="text-xs text-silver-500 mb-2">{row.pickup_city}</Text>
        <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
          {row.dropoff_line1 ?? 'in-home'}
        </Text>
        <Text className="text-xs text-silver-500">{row.dropoff_city ?? ''}</Text>
      </View>
    </View>
  );
}

function statusTone(status: string): 'success' | 'warning' | 'brand' | 'neutral' {
  if (status === 'completed') return 'neutral';
  if (status === 'cancelled' || status === 'failed') return 'warning';
  if (status === 'assigned') return 'brand';
  return 'success';
}

// ─── Assign-driver modal ────────────────────────────────────────────────────

function AssignDriverModal({
  target,
  companyId,
  busy,
  onClose,
  onAssign,
}: {
  target: DispatchQueueRow | null;
  companyId: string;
  busy: boolean;
  onClose: () => void;
  onAssign: (driverProfileId: string) => void;
}) {
  const { data: roster, isLoading } = useCompanyDriverRoster(companyId);
  const [pingTarget, setPingTarget] = useState<CompanyDriverRosterRow | null>(null);

  return (
    <Modal
      visible={!!target}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: '85%' }}
        >
          <View className="px-6 pt-5 pb-3">
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
            <Text className="text-xl font-bold text-ink-900">Assign a driver</Text>
            <Text className="mt-1 text-sm text-silver-500">
              {target ? `#${target.short_code} · ${fmtCurrency(target.price_total_cents / 100)}` : ''}
            </Text>
            <Text className="mt-2 text-[11px] text-silver-500">
              Tap a driver to assign · tap the chat icon to ping them first
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 28 }}>
            {isLoading ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#16A34A" />
              </View>
            ) : !roster || roster.length === 0 ? (
              <EmptyState
                icon="people-outline"
                title="No drivers on your roster"
                body="Add drivers from the Company tab → Drivers — they'll get an invite to join your fleet."
              />
            ) : (
              roster
                .slice()
                .sort((a, b) => {
                  if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
                  if (a.active_jobs !== b.active_jobs) return a.active_jobs - b.active_jobs;
                  return (a.full_name ?? '').localeCompare(b.full_name ?? '');
                })
                .map((d) => (
                  <DriverPickRow
                    key={d.profile_id}
                    driver={d}
                    busy={busy}
                    onPress={() => onAssign(d.profile_id)}
                    onPing={() => setPingTarget(d)}
                  />
                ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>

      {pingTarget && target ? (
        <DispatcherPingSheet
          visible
          onClose={() => setPingTarget(null)}
          driverId={pingTarget.profile_id}
          driverName={pingTarget.full_name ?? 'driver'}
          bookingId={target.id}
          shortCode={target.short_code}
          pickupCity={target.pickup_city}
          dropoffCity={target.dropoff_city ?? ''}
          scheduledForDate={target.scheduled_for_date}
          scheduledForWindow={target.scheduled_for_window}
        />
      ) : null}
    </Modal>
  );
}

function DriverPickRow({
  driver,
  busy,
  onPress,
  onPing,
}: {
  driver: CompanyDriverRosterRow;
  busy: boolean;
  onPress: () => void;
  onPing: () => void;
}) {
  const isBusy = driver.active_jobs > 0;
  const isOffline = !driver.is_online;

  // The assign decision turns on availability + current load, not paperwork —
  // so we lead with those and drop the license number entirely. Assigning a
  // move to an offline driver who isn't watching the app strands the customer,
  // so offline taps get a hard-warn confirm before the assignment fires.
  // (The roster RPC doesn't carry rating/truck size yet; surface them here too
  // once it does.)
  const handlePress = () => {
    if (isOffline) {
      Alert.alert(
        `${driver.full_name ?? 'This driver'} is offline`,
        `Last seen ${fmtRelativeAgo(
          driver.last_online_at,
        )}. They may not see this assignment right away — ping them first, or assign anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Assign anyway', style: 'destructive', onPress },
        ],
      );
      return;
    }
    onPress();
  };

  // Subtitle = availability + load, the two facts that drive the pick.
  const availabilityLabel = isOffline
    ? `Offline · last seen ${fmtRelativeAgo(driver.last_online_at)}`
    : isBusy
    ? `${driver.active_jobs} active ${driver.active_jobs === 1 ? 'job' : 'jobs'}`
    : 'Free now';
  const availabilityIcon = isOffline
    ? 'cloud-offline-outline'
    : isBusy
    ? 'time-outline'
    : 'checkmark-circle';
  const availabilityColor = isOffline ? '#A1A1AA' : isBusy ? '#92400E' : '#047857';
  const availabilityText = isOffline
    ? 'text-silver-500'
    : isBusy
    ? 'text-amber-800'
    : 'text-brand-700';

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      className={`mb-3 rounded-2xl border p-4 active:opacity-80 ${
        isOffline ? 'border-silver-200 bg-silver-50' : 'border-brand-100 bg-white'
      }`}
    >
      <View className="flex-row items-center">
        <View className="relative">
          <View
            className={`h-10 w-10 rounded-full items-center justify-center ${
              isOffline ? 'bg-silver-200' : 'bg-brand-600'
            }`}
          >
            <Ionicons name="person" size={18} color={isOffline ? '#52525B' : '#fff'} />
          </View>
          <View
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
              driver.is_online ? 'bg-brand-600' : 'bg-silver-400'
            }`}
          />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base font-bold text-ink-900">{driver.full_name ?? '—'}</Text>
          <View className="flex-row items-center mt-0.5">
            <Ionicons name={availabilityIcon} size={12} color={availabilityColor} />
            <Text className={`ml-1 text-xs ${availabilityText}`}>{availabilityLabel}</Text>
          </View>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onPing();
          }}
          hitSlop={8}
          disabled={busy}
          className="h-10 w-10 rounded-full bg-silver-100 items-center justify-center mr-2 active:opacity-80"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#0A0A0A" />
        </Pressable>
        {/* Trailing affordance — online drivers assign on tap; offline drivers
            route through the confirm first, so we flag the caution instead. */}
        {isOffline ? (
          <Ionicons name="alert-circle-outline" size={18} color="#A1A1AA" />
        ) : (
          <View className="flex-row items-center">
            <Text className="text-xs font-bold text-brand-700 mr-0.5">Assign</Text>
            <Ionicons name="chevron-forward" size={16} color="#047857" />
          </View>
        )}
      </View>
    </Pressable>
  );
}
