// =============================================================================
// /(company)/drivers — driver roster (live)
//
// Reached from the Company (profile) tab now that we trimmed the bottom bar
// to 5 entries. Lists every active driver in the company with their
// online state + active-job count, computed by the company_drivers_roster
// RPC (migration 0017 + 0018).
//
// "+" button up top opens a sheet to invite a new driver — wires to
// partners-invite-send so the invite SMS/email fires immediately.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { BulkReassignSheet } from '@/components/BulkReassignSheet';
import { AddDriverSheet } from '@/components/AddDriverSheet';
import { PendingApprovals } from '@/components/PendingApprovals';
import { useMyMembership, useCompanyDriverRoster, usePendingJoinRequests } from '@/lib/data';
import { supabaseConfigured } from '@/lib/supabase';
import { NotificationBell } from '@/components/NotificationBell';

export default function CompanyDrivers() {
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const isDispatcher =
    membership?.kind === 'company' &&
    membership.org_role === 'admin';
  const { data: roster, isLoading, refetch, isRefetching } = useCompanyDriverRoster(companyId);

  // Self-joiners who used the company code and are waiting to be let in. Pulled
  // at the screen level (not just inside <PendingApprovals>) so the "no drivers
  // yet" empty state can step aside when there's a queue to review. React Query
  // dedupes this against the identical call inside the component.
  const { data: pendingRequests } = usePendingJoinRequests('company', companyId);
  const pendingCount = pendingRequests?.length ?? 0;

  const total = roster?.length ?? 0;
  const online = roster?.filter((d) => d.is_online).length ?? 0;

  // Bulk reassign — when a driver is out, dispatcher taps "Reassign" on
  // their row to move every in-flight booking to another driver.
  const [reassignTarget, setReassignTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Post-onboarding single-driver invite. The "+" button used to dump the
  // dispatcher back into the onboarding wizard, which is wrong UX — they
  // already onboarded. This sheet captures one driver and fires the invite
  // email + SMS right away.
  const [addDriverOpen, setAddDriverOpen] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Your crew"
          subtitle={membership?.company_name ?? undefined}
          showBack
          right={
            <View className="flex-row items-center gap-2">
              <NotificationBell href="/(company)/notifications" />
              {isDispatcher ? (
                <Pressable
                  onPress={() => setAddDriverOpen(true)}
                  className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center active:opacity-90"
                  accessibilityRole="button"
                  accessibilityLabel="Invite a driver"
                >
                  <Ionicons name="add" size={20} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          }
        />
      </View>

      {isLoading && !roster ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={4} />
        </ScrollView>
      ) : !supabaseConfigured ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase in .env.local to load your live driver roster."
        />
      ) : (!roster || roster.length === 0) && pendingCount === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No drivers on your roster yet"
          body={
            isDispatcher
              ? 'Tap the + button to invite drivers. They’ll get an SMS/email with your company code.'
              : "Your dispatcher hasn't added drivers yet."
          }
          actionLabel={isDispatcher ? 'Invite drivers' : undefined}
          onAction={
            isDispatcher
              ? () => setAddDriverOpen(true)
              : undefined
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor="#16A34A"
            />
          }
        >
          <View className="flex-row gap-3 mb-4">
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Total drivers</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{total}</Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Online now</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{online}</Text>
            </Card>
          </View>

          {(roster ?? [])
            .slice()
            // Online first, then by active-jobs ascending, then by name
            .sort((a, b) => {
              if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
              if (a.active_jobs !== b.active_jobs) return a.active_jobs - b.active_jobs;
              return (a.full_name ?? '').localeCompare(b.full_name ?? '');
            })
            .map((d) => {
              const onJob = d.active_jobs > 0;
              const label = !d.is_online ? 'Offline' : onJob ? 'On job' : 'Online';
              const tone: 'neutral' | 'warning' | 'success' = !d.is_online
                ? 'neutral'
                : onJob
                ? 'warning'
                : 'success';
              return (
                <View key={d.profile_id} className="mb-3">
                  <Card>
                    <View className="flex-row items-center">
                      <View className="relative">
                        <Avatar name={d.full_name ?? 'Driver'} size={48} />
                        <View
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                            d.is_online ? 'bg-brand-600' : 'bg-silver-400'
                          }`}
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-base font-bold text-ink-900">
                          {d.full_name ?? '—'}
                        </Text>
                        <Text className="text-xs text-silver-500 mt-0.5">
                          {d.driver_license_number ?? 'License pending'}
                        </Text>
                        <Text className="text-xs text-silver-500">
                          {onJob ? `${d.active_jobs} active` : '0 active'}
                        </Text>
                      </View>
                      <Badge label={label} tone={tone} />
                    </View>

                    {/* Reassign all — only shown when the driver actually
                        has in-flight bookings to move. Dispatchers + owners
                        only. */}
                    {isDispatcher && d.active_jobs > 0 ? (
                      <Pressable
                        onPress={() =>
                          setReassignTarget({
                            id: d.profile_id,
                            name: d.full_name ?? 'this driver',
                          })
                        }
                        className="mt-3 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row items-center active:opacity-80"
                      >
                        <View className="h-8 w-8 rounded-full bg-amber-500 items-center justify-center">
                          <Ionicons name="swap-horizontal" size={16} color="#fff" />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-sm font-bold text-ink-900">
                            Reassign {d.active_jobs}{' '}
                            {d.active_jobs === 1 ? 'job' : 'jobs'}
                          </Text>
                          <Text className="text-[11px] text-silver-600 mt-0.5">
                            Driver out? Move every active booking to another
                            driver
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#B45309" />
                      </Pressable>
                    ) : null}
                  </Card>
                </View>
              );
            })}

          {/* ─── Pending approvals ─────────────────────────────────────────── */}
          {/* Self-joiners who used the company code and are waiting on an
              owner/dispatcher. Renders nothing when the queue is empty. */}
          <PendingApprovals kind="company" subjectId={companyId} />
        </ScrollView>
      )}

      {/* Bulk-reassign sheet — pulls the source driver's active bookings +
          the rest of the roster, runs bookings-dispatch-assign per booking. */}
      {reassignTarget && companyId ? (
        <BulkReassignSheet
          visible
          onClose={() => setReassignTarget(null)}
          companyId={companyId}
          sourceDriverId={reassignTarget.id}
          sourceDriverName={reassignTarget.name}
        />
      ) : null}

      {/* Add-driver sheet — collects name + email (and optional phone),
          fires partners-invite-send → branded HTML email + optional SMS
          immediately. Driver gets the company code + app links and can
          accept from any device. */}
      <AddDriverSheet
        visible={addDriverOpen}
        companyId={companyId}
        onClose={() => setAddDriverOpen(false)}
      />
    </SafeAreaView>
  );
}
