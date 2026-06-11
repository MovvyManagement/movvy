import React, { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { supabase } from '@/lib/supabase';
import { useAdminPendingVerifications, useVerifyPartner, useSuspendUser } from '@/lib/data';

const tabs = ['Customers', 'Drivers', 'Companies', 'Pending review'] as const;

export default function AdminUsers() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Pending review');

  const customers = useQuery({
    queryKey: ['admin', 'profiles', 'customer'],
    enabled: tab === 'Customers',
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, is_suspended, created_at, role')
        .eq('role', 'customer')
        .order('created_at', { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const drivers = useQuery({
    queryKey: ['admin', 'profiles', 'drivers'],
    enabled: tab === 'Drivers',
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, is_suspended, created_at, role')
        .in('role', ['driver', 'mover'])
        .order('created_at', { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const companies = useQuery({
    queryKey: ['admin', 'companies', 'all'],
    enabled: tab === 'Companies',
    queryFn: async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, display_name, legal_name, onboarding_status, rating_avg, rating_count, created_at, primary_city_id')
        .order('created_at', { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const pending = useAdminPendingVerifications();
  const verify = useVerifyPartner();
  const suspend = useSuspendUser();

  const decide = (subjectType: 'team' | 'company', subjectId: string, decision: 'approve' | 'reject') => {
    Alert.prompt(
      `${decision === 'approve' ? 'Approve' : 'Reject'} ${subjectType}`,
      decision === 'reject' ? 'Reason (shown to applicant):' : 'Optional notes:',
      async (notes) => {
        try {
          await verify.mutateAsync({
            subject_type: subjectType,
            subject_id: subjectId,
            decision,
            notes: notes?.trim() || undefined,
          });
          Alert.alert('Done', `${subjectType} ${decision}d.`);
        } catch (e: any) {
          Alert.alert('Failed', e?.message ?? 'Try again.');
        }
      },
      'plain-text',
    );
  };

  const toggleSuspend = (profileId: string, currentlySuspended: boolean) => {
    Alert.prompt(
      currentlySuspended ? 'Reinstate user' : 'Suspend user',
      'Reason (audit trail):',
      async (reason) => {
        try {
          await suspend.mutateAsync({
            profile_id: profileId,
            action: currentlySuspended ? 'reinstate' : 'suspend',
            reason: reason?.trim() || undefined,
          });
          Alert.alert('Done', currentlySuspended ? 'User reinstated.' : 'User suspended.');
        } catch (e: any) {
          Alert.alert('Failed', e?.message ?? 'Try again.');
        }
      },
      'plain-text',
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Users" showBack={false} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 8 }}
        >
          {tabs.map((t) => (
            <Chip key={t} label={t} selected={tab === t} onPress={() => setTab(t)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {tab === 'Pending review' ? (
          <>
            {pending.isLoading ? (
              <ActivityIndicator color="#16A34A" />
            ) : pending.data && pending.data.teams.length + pending.data.companies.length > 0 ? (
              <>
                {pending.data.teams.map((t) => (
                  <View key={t.id} className="mb-3">
                    <Card>
                      <View className="flex-row items-center">
                        <View className="h-11 w-11 rounded-2xl bg-brand-50 items-center justify-center">
                          <Ionicons name="people" size={20} color="#047857" />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-sm font-bold text-ink-900">
                            {t.display_name ?? '2-person crew'}
                          </Text>
                          <Text className="text-xs text-silver-500">Team · {t.onboarding_status.replace('_', ' ')}</Text>
                        </View>
                      </View>
                      <View className="mt-3 flex-row gap-2">
                        <Pressable
                          onPress={() => decide('team', t.id, 'reject')}
                          className="flex-1 h-10 rounded-2xl bg-silver-100 items-center justify-center"
                        >
                          <Text className="text-xs font-bold text-ink-900">Reject</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => decide('team', t.id, 'approve')}
                          className="flex-1 h-10 rounded-2xl bg-brand-600 items-center justify-center"
                        >
                          <Text className="text-xs font-bold text-white">Approve</Text>
                        </Pressable>
                      </View>
                    </Card>
                  </View>
                ))}
                {pending.data.companies.map((c) => (
                  <View key={c.id} className="mb-3">
                    <Card>
                      <View className="flex-row items-center">
                        <View className="h-11 w-11 rounded-2xl bg-ink-900 items-center justify-center">
                          <Ionicons name="business" size={20} color="#fff" />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-sm font-bold text-ink-900">{c.display_name}</Text>
                          <Text className="text-xs text-silver-500">Company · {c.onboarding_status.replace('_', ' ')}</Text>
                        </View>
                      </View>
                      <View className="mt-3 flex-row gap-2">
                        <Pressable
                          onPress={() => decide('company', c.id, 'reject')}
                          className="flex-1 h-10 rounded-2xl bg-silver-100 items-center justify-center"
                        >
                          <Text className="text-xs font-bold text-ink-900">Reject</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => decide('company', c.id, 'approve')}
                          className="flex-1 h-10 rounded-2xl bg-brand-600 items-center justify-center"
                        >
                          <Text className="text-xs font-bold text-white">Approve</Text>
                        </Pressable>
                      </View>
                    </Card>
                  </View>
                ))}
              </>
            ) : (
              <EmptyState icon="checkmark-done" title="All clear" body="Nothing pending review." />
            )}
          </>
        ) : null}

        {tab === 'Customers' &&
          (customers.isLoading ? (
            <ActivityIndicator color="#16A34A" />
          ) : (
            customers.data?.map((c) => (
              <View key={c.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <Avatar name={c.full_name ?? c.email ?? '?'} size={44} tone="silver" />
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900">{c.full_name ?? '—'}</Text>
                      <Text className="text-xs text-silver-500">{c.email ?? c.phone ?? ''}</Text>
                    </View>
                    {c.is_suspended ? (
                      <Badge label="Suspended" tone="danger" />
                    ) : (
                      <Pressable
                        onPress={() => toggleSuspend(c.id, c.is_suspended)}
                        className="h-9 rounded-full bg-silver-100 px-3 items-center justify-center"
                      >
                        <Text className="text-xs font-bold text-ink-700">Suspend</Text>
                      </Pressable>
                    )}
                  </View>
                </Card>
              </View>
            ))
          ))}

        {tab === 'Drivers' &&
          (drivers.isLoading ? (
            <ActivityIndicator color="#16A34A" />
          ) : (
            drivers.data?.map((d) => (
              <View key={d.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <Avatar name={d.full_name ?? d.email ?? '?'} size={44} />
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900">{d.full_name ?? '—'}</Text>
                      <Text className="text-xs text-silver-500">{d.email ?? d.phone ?? ''} · {d.role}</Text>
                    </View>
                    {d.is_suspended ? (
                      <Badge label="Suspended" tone="danger" />
                    ) : (
                      <Pressable
                        onPress={() => toggleSuspend(d.id, d.is_suspended)}
                        className="h-9 rounded-full bg-silver-100 px-3 items-center justify-center"
                      >
                        <Text className="text-xs font-bold text-ink-700">Suspend</Text>
                      </Pressable>
                    )}
                  </View>
                </Card>
              </View>
            ))
          ))}

        {tab === 'Companies' &&
          (companies.isLoading ? (
            <ActivityIndicator color="#16A34A" />
          ) : (
            companies.data?.map((c) => (
              <View key={c.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <View className="h-11 w-11 rounded-2xl bg-brand-600 items-center justify-center">
                      <Ionicons name="business" size={20} color="#fff" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900">{c.display_name}</Text>
                      <Text className="text-xs text-silver-500">{c.legal_name}</Text>
                    </View>
                    <Badge
                      label={c.onboarding_status === 'verified' ? 'Verified' : c.onboarding_status.replace('_', ' ')}
                      tone={c.onboarding_status === 'verified' ? 'success' : 'warning'}
                    />
                  </View>
                </Card>
              </View>
            ))
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
