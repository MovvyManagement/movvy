// =============================================================================
// /(company)/trucks — fleet management
//
// Lists every truck on the company's `vehicles` row. Owners + dispatchers
// can add new trucks via AddTruckSheet; deletion uses a long-press confirm
// (kept off the obvious tap target so a stray finger can't wipe a vehicle).
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { AddTruckSheet } from '@/components/AddTruckSheet';
import {
  useMyMembership,
  useCompanyVehicles,
  useDeleteCompanyVehicle,
} from '@/lib/data';
import { useToast } from '@/components/Toast';
import { NotificationBell } from '@/components/NotificationBell';
import { supabaseConfigured } from '@/lib/supabase';

const TYPE_LABELS: Record<string, string> = {
  cargo_van: 'Cargo van',
  cube_van_16: '16 ft cube',
  box_truck_24: '24 ft box',
  box_truck_26: '26 ft box',
  pickup_truck: 'Pickup',
  other: 'Other',
};

export default function CompanyTrucks() {
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const isDispatcher =
    membership?.kind === 'company' &&
    (membership.role === 'owner' || membership.role === 'dispatcher');

  const { data: trucks, isLoading, refetch, isRefetching } = useCompanyVehicles(companyId);
  const del = useDeleteCompanyVehicle(companyId);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);

  const confirmDelete = (id: string, label: string) => {
    Alert.alert(
      `Remove ${label}?`,
      "This won't affect bookings the truck has already been assigned to. Active assignments stay until the move is completed.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await del.mutateAsync(id);
              toast.success('Truck removed');
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't remove truck");
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Trucks"
          subtitle={membership?.company_name ?? undefined}
          showBack
          right={
            <View className="flex-row items-center gap-2">
              <NotificationBell href="/(company)/notifications" />
              {isDispatcher ? (
                <Pressable
                  onPress={() => setAddOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add truck"
                  className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center active:opacity-90"
                >
                  <Ionicons name="add" size={20} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          }
        />
      </View>

      {isLoading && !trucks ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={3} />
        </ScrollView>
      ) : !supabaseConfigured ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase to load your fleet."
        />
      ) : !trucks || trucks.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title="No trucks yet"
          body={
            isDispatcher
              ? 'Add your first truck so dispatchers can assign it to bookings.'
              : 'Your dispatcher hasn’t added trucks yet.'
          }
          actionLabel={isDispatcher ? 'Add a truck' : undefined}
          onAction={isDispatcher ? () => setAddOpen(true) : undefined}
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
              <Text className="text-xs text-silver-500 uppercase font-semibold">Fleet size</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{trucks.length}</Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Largest</Text>
              <Text className="text-base font-bold text-ink-900 mt-2">
                {TYPE_LABELS[
                  trucks.reduce((max, t) => {
                    const order = [
                      'pickup_truck',
                      'cargo_van',
                      'cube_van_16',
                      'box_truck_24',
                      'box_truck_26',
                      'other',
                    ];
                    return order.indexOf(t.type) > order.indexOf(max) ? t.type : max;
                  }, 'pickup_truck')
                ] ?? '—'}
              </Text>
            </Card>
          </View>

          {trucks.map((t) => (
            <View key={t.id} className="mb-3">
              <Card>
                <View className="flex-row items-center">
                  <View className="h-12 w-12 rounded-2xl bg-silver-100 items-center justify-center">
                    <Ionicons name="car-outline" size={22} color="#0A0A0A" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-base font-bold text-ink-900">
                      {t.make ?? '—'} {t.model ?? ''}
                    </Text>
                    <Text className="text-xs text-silver-500 mt-0.5">
                      {[
                        TYPE_LABELS[t.type] ?? t.type,
                        t.year,
                        t.capacity_cu_ft ? `${t.capacity_cu_ft} cu ft` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    <Text className="text-xs text-silver-500 mt-0.5">
                      Plate {t.plate} · {t.province}
                    </Text>
                  </View>
                  <Badge label={TYPE_LABELS[t.type] ?? t.type} tone="neutral" />
                </View>
                {isDispatcher ? (
                  <Pressable
                    onPress={() =>
                      confirmDelete(
                        t.id,
                        `${t.make ?? ''} ${t.model ?? ''}`.trim() || 'this truck',
                      )
                    }
                    className="mt-3 h-10 rounded-xl border border-silver-200 items-center justify-center active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-danger">Remove from fleet</Text>
                  </Pressable>
                ) : null}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}

      <AddTruckSheet
        visible={addOpen}
        companyId={companyId}
        onClose={() => setAddOpen(false)}
      />
    </SafeAreaView>
  );
}
