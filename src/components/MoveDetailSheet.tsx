// =============================================================================
// MoveDetailSheet — the dispatcher's full view of one scheduled move.
//
// Opened by tapping a card in the Jobs → Scheduled tab. This is the ONLY place
// an admin manages a booking: everything they need to decide is here (what the
// move actually is, when, the full route, extras, customer notes, price, who's
// on it) plus the two actions —
//   • Reassign — hand the move to a different crew member (or take it yourself)
//   • Release  — give the move back to the open pool for other orgs
//
// Crew management (make admin / remove) lives on the Crew screen; job actions
// live here. That split is deliberate so the two never bleed into each other.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { LiveMap } from '@/components/LiveMap';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { fmtCurrency } from '@/lib/format';
import { moveSummary, moveWhen, moveExtras } from '@/lib/moveSummary';
import { useAuth } from '@/lib/supabase';
import {
  useBooking,
  useCompanyDriverRoster,
  useDispatcherAssign,
  useDispatcherDecline,
  type CompanyDriverRosterRow,
} from '@/lib/data';

interface Props {
  bookingId: string | null;
  companyId: string;
  onClose: () => void;
}

export function MoveDetailSheet({ bookingId, companyId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const { data: booking, isLoading } = useBooking(bookingId ?? undefined);
  const { data: roster } = useCompanyDriverRoster(companyId);
  const assign = useDispatcherAssign();
  const release = useDispatcherDecline();

  const [picking, setPicking] = useState(false);

  const assignedId = (booking as any)?.assigned_driver_profile_id ?? null;
  const assigneeName = assignedId
    ? assignedId === user?.id
      ? 'You'
      : roster?.find((d) => d.profile_id === assignedId)?.full_name ?? 'Assigned'
    : null;

  // Who can take this move: everyone on the roster, plus the signed-in admin
  // ("You") — admins aren't on the driver roster, so without this they could
  // never put a move on themselves from here.
  const candidates = useMemo<CompanyDriverRosterRow[]>(() => {
    const list = (roster ?? []).filter((d) => d.profile_id !== assignedId);
    const sorted = list.slice().sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      if (a.active_jobs !== b.active_jobs) return a.active_jobs - b.active_jobs;
      return (a.full_name ?? '').localeCompare(b.full_name ?? '');
    });
    const meListed = sorted.some((d) => d.profile_id === user?.id);
    if (!user?.id || meListed || user.id === assignedId) return sorted;
    return [
      {
        profile_id: user.id,
        full_name: 'You',
        email: null,
        phone: null,
        driver_license_number: null,
        active_jobs: 0,
        is_online: true,
        last_online_at: null,
      } as CompanyDriverRosterRow,
      ...sorted,
    ];
  }, [roster, assignedId, user?.id]);

  const doAssign = async (driverProfileId: string, name: string) => {
    if (!bookingId) return;
    try {
      await assign.mutateAsync({
        booking_id: bookingId,
        company_id: companyId,
        driver_profile_id: driverProfileId,
      });
      haptic.success();
      toast.success(assignedId ? `Reassigned to ${name}` : `Assigned to ${name}`);
      setPicking(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not assign this move.');
    }
  };

  const doRelease = () => {
    if (!bookingId) return;
    Alert.alert(
      'Release this move?',
      'It goes back to the open pool for other crews to accept. You can’t undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          style: 'destructive',
          onPress: async () => {
            try {
              await release.mutateAsync({ booking_id: bookingId, company_id: companyId });
              haptic.warning();
              toast.success('Move released back to the pool');
              onClose();
            } catch (e: any) {
              toast.error(e?.message ?? 'Could not release this move.');
            }
          },
        },
      ],
    );
  };

  // useBooking selects '*', so the row carries FLAT columns (pickup_line1,
  // pickup_lat, …) — not the nested pickup/dropoff objects some screens build.
  const b = booking as any;
  const pickup =
    b?.pickup_lat != null
      ? { lat: Number(b.pickup_lat), lng: Number(b.pickup_lng), label: b.pickup_line1 }
      : undefined;
  const dropoff =
    b?.dropoff_lat != null
      ? { lat: Number(b.dropoff_lat), lng: Number(b.dropoff_lng), label: b.dropoff_line1 }
      : undefined;

  const extras = moveExtras(booking);
  const notes = (booking as any)?.customer_notes ?? (booking as any)?.details?.notes ?? null;

  return (
    <Modal visible={!!bookingId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: '92%' }}
        >
          <View className="px-6 pt-4 pb-2">
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
            {isLoading || !booking ? null : (
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-2xl font-bold text-ink-900">{moveSummary(booking)}</Text>
                  <View className="mt-1 flex-row items-center">
                    <Ionicons name="calendar-outline" size={14} color="#047857" />
                    <Text className="ml-1.5 text-xs font-semibold text-brand-700">
                      {moveWhen(booking)}
                    </Text>
                  </View>
                </View>
                <Text className="text-xl font-bold text-ink-900">
                  {fmtCurrency(((booking as any).price_total_cents ?? 0) / 100)}
                </Text>
              </View>
            )}
          </View>

          {isLoading || !booking ? (
            <View className="py-16 items-center">
              <ActivityIndicator color="#16A34A" />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <View className="flex-row items-center gap-2">
                <Badge label={String(booking.status).replace(/_/g, ' ')} tone="brand" />
                <Text className="text-xs text-silver-500">#{(booking as any).short_code}</Text>
              </View>

              {/* Who's on it */}
              <View className="mt-4 flex-row items-center rounded-2xl bg-silver-50 px-3 py-3">
                <Ionicons
                  name={assigneeName ? 'person-circle-outline' : 'alert-circle-outline'}
                  size={18}
                  color={assigneeName ? '#047857' : '#B45309'}
                />
                <Text className="ml-2 text-sm text-silver-600">
                  {assigneeName ? 'Assigned to' : 'Needs a driver'}
                </Text>
                {assigneeName ? (
                  <Text className="ml-1 text-sm font-bold text-ink-900">{assigneeName}</Text>
                ) : null}
              </View>

              {/* Route */}
              <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500">
                Route
              </Text>
              <View className="mt-2 flex-row">
                <View className="items-center mr-3">
                  <View className="h-3 w-3 rounded-full bg-ink-900" />
                  <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 22 }} />
                  <View className="h-3 w-3 rounded-full bg-brand-600" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-ink-900">{b.pickup_line1}</Text>
                  <Text className="text-xs text-silver-500 mb-3">{b.pickup_city}</Text>
                  <Text className="text-sm font-semibold text-ink-900">
                    {b.dropoff_line1 ?? 'In-home'}
                  </Text>
                  <Text className="text-xs text-silver-500">{b.dropoff_city ?? ''}</Text>
                </View>
              </View>

              {pickup ? (
                <View className="mt-4 rounded-2xl overflow-hidden">
                  <View pointerEvents="none">
                    <LiveMap
                      height={150}
                      borderRadius={16}
                      pickup={pickup}
                      dropoff={dropoff}
                      showRoute={!!dropoff}
                    />
                  </View>
                </View>
              ) : null}

              {/* What the job involves */}
              {extras.length > 0 ? (
                <>
                  <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500">
                    Included
                  </Text>
                  <View className="mt-2 flex-row flex-wrap gap-1.5">
                    {extras.map((c) => (
                      <View key={c} className="px-2.5 py-1 rounded-full bg-silver-100">
                        <Text className="text-[11px] font-semibold text-ink-700">{c}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {notes ? (
                <>
                  <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500">
                    Customer notes
                  </Text>
                  <View className="mt-2 rounded-2xl bg-silver-50 p-3">
                    <Text className="text-sm text-ink-900 leading-5">{String(notes)}</Text>
                  </View>
                </>
              ) : null}

              {/* Reassign picker */}
              {picking ? (
                <>
                  <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500">
                    {assignedId ? 'Reassign to' : 'Assign to'}
                  </Text>
                  {candidates.length === 0 ? (
                    <View className="mt-2 rounded-2xl border border-dashed border-silver-300 p-4">
                      <Text className="text-sm text-silver-500">
                        No one else on your crew yet — invite people from the Crew tab.
                      </Text>
                    </View>
                  ) : (
                    candidates.map((d) => (
                      <Pressable
                        key={d.profile_id}
                        disabled={assign.isPending}
                        onPress={() => doAssign(d.profile_id, d.full_name ?? 'crew')}
                        className="mt-2 flex-row items-center rounded-2xl border border-silver-200 bg-white p-3 active:opacity-80"
                      >
                        <View className="h-9 w-9 rounded-full bg-brand-600 items-center justify-center">
                          <Text className="text-xs font-bold text-white">
                            {(d.full_name ?? '?').slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-sm font-bold text-ink-900">{d.full_name}</Text>
                          <Text className="text-xs text-silver-500">
                            {d.is_online ? 'Online' : 'Offline'} · {d.active_jobs} active
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
                      </Pressable>
                    ))
                  )}
                </>
              ) : null}
            </ScrollView>
          )}

          {/* Actions */}
          <View
            className="border-t border-silver-100 px-6 pt-3 flex-row gap-3"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <Pressable
              onPress={doRelease}
              disabled={release.isPending || !booking}
              className="flex-1 h-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
            >
              <Text className="text-sm font-bold text-danger">
                {release.isPending ? 'Releasing…' : 'Release'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPicking((p) => !p)}
              disabled={!booking}
              className="flex-[1.4] h-12 rounded-2xl bg-brand-600 flex-row items-center justify-center active:opacity-90"
            >
              <Ionicons name="swap-horizontal" size={16} color="#fff" />
              <Text className="ml-2 text-sm font-bold text-white">
                {picking ? 'Close picker' : assignedId ? 'Reassign' : 'Assign driver'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
