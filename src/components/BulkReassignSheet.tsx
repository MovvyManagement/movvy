// =============================================================================
// BulkReassignSheet
//
// Dispatcher tool: "Driver X called in sick — reassign all their jobs to
// driver Y." Opens from the drivers roster, lists every active assignment
// for the source driver, lets the dispatcher pick a replacement, then loops
// bookings-dispatch-assign for each booking.
//
// Per-booking failures (e.g. the replacement is already on that job, race
// with the customer cancelling) are surfaced inline so the dispatcher can
// re-try the leftovers rather than the whole batch.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import {
  useCompanyDriverRoster,
  useDispatcherAssign,
  type CompanyDriverRosterRow,
} from '@/lib/data';
import { useToast } from './Toast';
import { Avatar } from './Avatar';
import { fmtDateShort } from '@/lib/format';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  companyId: string;
  sourceDriverId: string;
  sourceDriverName: string;
}

const IN_FLIGHT = ['assigned', 'confirmed', 'on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'];

interface AssignedRow {
  id: string;
  short_code: string;
  status: string;
  pickup_line1: string;
  pickup_city: string;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
}

export function BulkReassignSheet({
  visible,
  onClose,
  companyId,
  sourceDriverId,
  sourceDriverName,
}: Props) {
  const toast = useToast();
  const assign = useDispatcherAssign();
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bookings currently assigned to the sick driver, in-flight only. We don't
  // touch completed/cancelled rows — those are history.
  const { data: bookings, isLoading: bLoading } = useQuery({
    queryKey: ['bulk-reassign', sourceDriverId, companyId],
    enabled: visible && supabaseConfigured && !!sourceDriverId,
    queryFn: async (): Promise<AssignedRow[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, short_code, status, pickup_line1, pickup_city, dropoff_line1, dropoff_city, scheduled_for_date, scheduled_for_window',
        )
        .eq('assigned_driver_profile_id', sourceDriverId)
        .eq('assigned_company_id', companyId)
        .in('status', IN_FLIGHT)
        .order('scheduled_for_window_starts_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AssignedRow[];
    },
  });

  const { data: roster, isLoading: rLoading } = useCompanyDriverRoster(companyId);

  // Eligible replacements — anyone in the roster except the source driver,
  // sorted online → least busy → name.
  const candidates = useMemo<CompanyDriverRosterRow[]>(() => {
    const list = (roster ?? []).filter((d) => d.profile_id !== sourceDriverId);
    return list.slice().sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      if (a.active_jobs !== b.active_jobs) return a.active_jobs - b.active_jobs;
      return (a.full_name ?? '').localeCompare(b.full_name ?? '');
    });
  }, [roster, sourceDriverId]);

  const count = bookings?.length ?? 0;

  const confirm = () => {
    if (!replacementId || !bookings || bookings.length === 0) return;
    const replacement = candidates.find((c) => c.profile_id === replacementId);
    Alert.alert(
      'Reassign all jobs?',
      `Move ${count} active ${count === 1 ? 'booking' : 'bookings'} from ${sourceDriverName} to ${
        replacement?.full_name ?? 'the selected driver'
      }. Customers won't be notified differently — they'll just see the new crew name.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reassign all', style: 'destructive', onPress: runBatch },
      ],
    );
  };

  const runBatch = async () => {
    if (!replacementId || !bookings) return;
    setBusy(true);
    const failures: string[] = [];
    for (const b of bookings) {
      try {
        await assign.mutateAsync({
          booking_id: b.id,
          company_id: companyId,
          driver_profile_id: replacementId,
        });
      } catch (e: any) {
        failures.push(b.short_code);
      }
    }
    setBusy(false);
    if (failures.length === 0) {
      haptic.success();
      toast.success(`Reassigned ${count} ${count === 1 ? 'job' : 'jobs'}`);
      onClose();
    } else {
      haptic.warning();
      toast.error(
        `Reassigned ${count - failures.length}/${count}. Couldn't move: ${failures.join(', ')}`,
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: '92%' }}
        >
          <View className="px-6 pt-5 pb-3 border-b border-silver-100">
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
            <Text className="text-xl font-bold text-ink-900">Reassign all jobs</Text>
            <Text className="mt-1 text-sm text-silver-500">
              {sourceDriverName} is out — pick a replacement and we'll move
              every active booking over in one shot.
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 30 }}>
            {/* Source jobs */}
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              Active bookings ({count})
            </Text>
            {bLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator color="#16A34A" />
              </View>
            ) : count === 0 ? (
              <View className="rounded-2xl border border-dashed border-silver-300 p-4 items-center">
                <Text className="text-sm text-silver-500">
                  {sourceDriverName} has no active jobs — nothing to move.
                </Text>
              </View>
            ) : (
              bookings!.map((b) => (
                <View
                  key={b.id}
                  className="rounded-2xl border border-silver-200 p-3 mb-2"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-bold text-ink-900">#{b.short_code}</Text>
                    <Text className="text-[10px] uppercase font-bold text-silver-500">
                      {b.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text className="text-xs text-silver-600 mt-1" numberOfLines={1}>
                    {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                  </Text>
                  <Text className="text-[11px] text-silver-500 mt-0.5">
                    {fmtDateShort(b.scheduled_for_date)}
                    {b.scheduled_for_window ? ` · ${b.scheduled_for_window}` : ''}
                  </Text>
                </View>
              ))
            )}

            {/* Replacement driver picker */}
            {count > 0 ? (
              <>
                <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-5 mb-2">
                  Pick replacement
                </Text>
                {rLoading ? (
                  <View className="py-6 items-center">
                    <ActivityIndicator color="#16A34A" />
                  </View>
                ) : candidates.length === 0 ? (
                  <View className="rounded-2xl border border-dashed border-silver-300 p-4">
                    <Text className="text-sm text-silver-500">
                      No other drivers on your roster. Invite more from the
                      Drivers screen first.
                    </Text>
                  </View>
                ) : (
                  candidates.map((d) => {
                    const sel = d.profile_id === replacementId;
                    return (
                      <Pressable
                        key={d.profile_id}
                        onPress={() => setReplacementId(sel ? null : d.profile_id)}
                        className={`mb-2 rounded-2xl border p-3 active:opacity-80 ${
                          sel
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-silver-200 bg-white'
                        }`}
                      >
                        <View className="flex-row items-center">
                          <View className="relative">
                            <Avatar name={d.full_name ?? 'Driver'} size={40} />
                            <View
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                                d.is_online ? 'bg-brand-600' : 'bg-silver-400'
                              }`}
                            />
                          </View>
                          <View className="ml-3 flex-1">
                            <Text className="text-sm font-bold text-ink-900">
                              {d.full_name ?? '—'}
                            </Text>
                            <Text className="text-[11px] text-silver-500">
                              {d.is_online ? 'Online' : 'Offline'} ·{' '}
                              {d.active_jobs} active
                            </Text>
                          </View>
                          {sel ? (
                            <Ionicons name="checkmark-circle" size={22} color="#047857" />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </>
            ) : null}
          </ScrollView>

          {/* Action bar */}
          {count > 0 ? (
            <View
              className="border-t border-silver-100 px-5 pt-3 bg-white flex-row gap-2"
              style={{ paddingBottom: 28 }}
            >
              <Pressable
                onPress={onClose}
                disabled={busy}
                className="flex-1 h-14 rounded-2xl bg-silver-100 items-center justify-center"
              >
                <Text className="text-sm font-bold text-ink-900">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={!replacementId || busy}
                className={`flex-[2] h-14 rounded-2xl items-center justify-center flex-row ${
                  !replacementId || busy
                    ? 'bg-silver-300'
                    : 'bg-brand-600 active:opacity-90'
                }`}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="swap-horizontal" size={18} color="#fff" />
                    <Text className="ml-2 text-base font-bold text-white">
                      Reassign {count} {count === 1 ? 'job' : 'jobs'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <View
              className="border-t border-silver-100 px-5 pt-3 bg-white"
              style={{ paddingBottom: 28 }}
            >
              <Pressable
                onPress={onClose}
                className="h-14 rounded-2xl bg-silver-100 items-center justify-center"
              >
                <Text className="text-sm font-bold text-ink-900">Close</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
