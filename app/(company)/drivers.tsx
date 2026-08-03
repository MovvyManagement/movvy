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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { AddDriverSheet } from '@/components/AddDriverSheet';
import { PendingApprovals } from '@/components/PendingApprovals';
import { useMyMembership, useCompanyDriverRoster, usePendingJoinRequests } from '@/lib/data';
import { supabase, supabaseConfigured, useAuth } from '@/lib/supabase';
import { NotificationBell } from '@/components/NotificationBell';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

export default function CompanyDrivers() {
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const isDispatcher =
    membership?.kind === 'company' &&
    membership.org_role === 'admin';
  const { data: roster, isLoading, refetch, isRefetching } = useCompanyDriverRoster(companyId);
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  // Each member's org_role so we can label promote/demote + show a role badge.
  const { data: memberRoles } = useQuery({
    queryKey: ['crew-roles', companyId],
    enabled: !!companyId && supabaseConfigured,
    queryFn: async () => {
      const { data } = await supabase
        .from('company_members')
        .select('profile_id, org_role')
        .eq('company_id', companyId!)
        .is('removed_at', null);
      const map: Record<string, string> = {};
      for (const r of data ?? []) map[(r as any).profile_id] = (r as any).org_role;
      return map;
    },
  });
  const refreshCrew = () => {
    qc.invalidateQueries({ queryKey: ['company-driver-roster'] });
    qc.invalidateQueries({ queryKey: ['crew-roles'] });
  };
  // Admin sees pricing; crew never does. Promote/demote flips org_role.
  const setMemberRole = async (profileId: string, org_role: 'admin' | 'crew') => {
    const { error } = await supabase
      .from('company_members')
      .update({ org_role })
      .eq('company_id', companyId!)
      .eq('profile_id', profileId)
      .is('removed_at', null);
    if (error) { toast.error(error.message); return; }
    haptic.success();
    toast.success(org_role === 'admin' ? 'Now an admin' : 'Now crew');
    refreshCrew();
  };
  const removeMember = (profileId: string, name: string, activeJobs = 0) => {
    // Job actions live in Jobs → Scheduled now, so removing someone here can't
    // silently strand the moves they're on. Send the admin there first.
    if (activeJobs > 0) {
      Alert.alert(
        'Move their jobs first',
        `${name} is still on ${activeJobs} active ${activeJobs === 1 ? 'move' : 'moves'}. Reassign ${
          activeJobs === 1 ? 'it' : 'them'
        } from Jobs → Scheduled, then remove them.`,
      );
      return;
    }
    Alert.alert('Remove from crew?', `${name} will lose access to your crew's jobs.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('company_members')
            .update({ removed_at: new Date().toISOString() })
            .eq('company_id', companyId!)
            .eq('profile_id', profileId)
            .is('removed_at', null);
          if (error) { toast.error(error.message); return; }
          haptic.success();
          toast.success(`Removed ${name}`);
          refreshCrew();
        },
      },
    ]);
  };

  // Self-joiners who used the company code and are waiting to be let in. Pulled
  // at the screen level (not just inside <PendingApprovals>) so the "no drivers
  // yet" empty state can step aside when there's a queue to review. React Query
  // dedupes this against the identical call inside the component.
  const { data: pendingRequests } = usePendingJoinRequests('company', companyId);
  const pendingCount = pendingRequests?.length ?? 0;

  const total = roster?.length ?? 0;
  const online = roster?.filter((d) => d.is_online).length ?? 0;

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

                    {/* Crew management — admins only, and not on themselves.
                        Promote/demote flips who sees pricing; Remove drops them
                        from the crew. */}
                    {isDispatcher && d.profile_id !== user?.id ? (
                      <View className="mt-3 flex-row items-center gap-2">
                        <Badge
                          label={memberRoles?.[d.profile_id] === 'admin' ? 'Admin' : 'Crew'}
                          tone={memberRoles?.[d.profile_id] === 'admin' ? 'brand' : 'neutral'}
                        />
                        <View className="flex-1" />
                        <Pressable
                          onPress={() =>
                            setMemberRole(
                              d.profile_id,
                              memberRoles?.[d.profile_id] === 'admin' ? 'crew' : 'admin',
                            )
                          }
                          className="rounded-xl border border-silver-200 px-3 py-2 active:opacity-80"
                        >
                          <Text className="text-xs font-semibold text-ink-900">
                            {memberRoles?.[d.profile_id] === 'admin' ? 'Make crew' : 'Make admin'}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => removeMember(d.profile_id, d.full_name ?? 'this member', d.active_jobs)}
                          className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 active:opacity-80"
                        >
                          <Text className="text-xs font-semibold text-danger">Remove</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {/* Job actions (reassign / release) deliberately do NOT live
                        here. Crew management is make-admin / make-crew / remove;
                        anything to do with a booking happens in Jobs → Scheduled,
                        so there's exactly one place to touch a move. */}
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
