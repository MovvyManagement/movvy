// =============================================================================
// /(admin)/bookings — operations view of every booking
//
// Was previously rendering the mockBookings fixture with three inert buttons
// (Reassign / Override price / Refund). It now reads the live bookings table
// via useAdminBookings, supports tab + search filtering, and exposes the two
// admin actions that are wired end-to-end:
//
//   • Cancel + 100% refund → bookings-cancel edge fn (admin role = full refund)
//   • Reassign → admin-reassign-booking edge fn (driver/team/company UUID prompt)
//
// "Override price" was removed — there's no edge function for it and silently
// re-saving on the bookings row would bypass the audit chain. When Stripe lands
// we'll add a refund-partial flow that records the new total + writes an audit
// row + issues the refund atomically.
// =============================================================================

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { useAdminBookings, useReassignBooking, useCancelBooking } from '@/lib/data';
import { fmtCurrency, fmtDateShort } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { PromptSheet } from '@/components/PromptSheet';

type TabKey = 'All' | 'Pending' | 'Active' | 'Completed' | 'Cancelled';
const tabs: TabKey[] = ['All', 'Pending', 'Active', 'Completed', 'Cancelled'];

// Status groupings — keep in sync with the booking_status enum in 0001_core.sql.
const ACTIVE_STATUSES = new Set([
  'pending',
  'searching',
  'assigned',
  'confirmed',
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
]);

function matchesTab(status: string, tab: TabKey): boolean {
  if (tab === 'All') return true;
  if (tab === 'Pending') return status === 'pending' || status === 'searching';
  if (tab === 'Active') return ACTIVE_STATUSES.has(status);
  if (tab === 'Completed') return status === 'completed';
  if (tab === 'Cancelled') return status === 'cancelled' || status === 'failed';
  return true;
}

export default function AdminBookings() {
  const [tab, setTab] = useState<TabKey>('All');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data: bookings, isLoading, refetch, isRefetching } = useAdminBookings({ limit: 200 });
  const reassign = useReassignBooking();
  const cancel = useCancelBooking();
  const toast = useToast();
  // Reassign target — drives the cross-platform PromptSheet (Alert.prompt was
  // iOS-only, so reassign was dead on Android).
  const [reassignTarget, setReassignTarget] = useState<any | null>(null);

  const filtered = useMemo(() => {
    const rows = bookings ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((b: any) => {
      if (!matchesTab(b.status, tab)) return false;
      if (!q) return true;
      // Search by short_code, city, or move_type.
      return (
        b.short_code?.toLowerCase().includes(q) ||
        b.pickup_city?.toLowerCase().includes(q) ||
        b.dropoff_city?.toLowerCase().includes(q) ||
        b.move_type?.toLowerCase().includes(q)
      );
    });
  }, [bookings, tab, search]);

  // Open the cross-platform reassign sheet (works identically on iOS + Android).
  const onReassign = (b: any) => setReassignTarget(b);

  // Runs when the admin submits the reassign sheet. Try as driver → team →
  // company; the edge fn validates each in turn so we don't have to introspect
  // the DB client-side.
  const submitReassign = async (values: Record<string, string>) => {
    const b = reassignTarget;
    if (!b) return;
    const id = (values.partner_id ?? '').trim();
    if (!id) throw new Error('Paste a team, company, or driver UUID.');
    try {
      await reassign.mutateAsync({ booking_id: b.id, driver_profile_id: id, reason: 'admin manual reassign' });
      toast.success(`Reassigned #${b.short_code}.`);
    } catch {
      try {
        await reassign.mutateAsync({ booking_id: b.id, team_id: id, reason: 'admin manual reassign' });
        toast.success(`Reassigned #${b.short_code} to team.`);
      } catch {
        try {
          await reassign.mutateAsync({ booking_id: b.id, company_id: id, reason: 'admin manual reassign' });
          toast.success(`Reassigned #${b.short_code} to company.`);
        } catch (e3: any) {
          throw new Error(e3?.message ?? 'Reassignment failed — UUID not found.');
        }
      }
    }
  };

  const onRefund = (b: any) => {
    Alert.alert(
      `Cancel + refund #${b.short_code}?`,
      `Customer will be refunded ${fmtCurrency(b.price_total_cents / 100)}. This stops the move and writes an audit row. This cannot be undone.`,
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel + full refund',
          style: 'destructive',
          onPress: async () => {
            try {
              // The bookings-cancel edge fn computes refund% from time-until-move
              // for customers but admins always get 100%. The reason string
              // shows up in the customer's cancellation history.
              await cancel.mutateAsync({
                booking_id: b.id,
                reason: 'Admin-issued full refund',
              });
              toast.success(`Cancelled #${b.short_code}. 100% refund queued.`);
            } catch (e: any) {
              toast.error(e?.message ?? 'Could not cancel.');
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
          title="Bookings"
          subtitle={bookings ? `${filtered.length} of ${bookings.length}` : undefined}
          showBack={false}
          right={
            <Pressable
              onPress={() => setSearchOpen((v) => !v)}
              className="h-10 w-10 rounded-full bg-silver-100 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? 'Hide search' : 'Search bookings'}
            >
              <Ionicons name={searchOpen ? 'close' : 'search'} size={18} color="#0A0A0A" />
            </Pressable>
          }
        />
        {searchOpen ? (
          <View className="px-5 pb-3">
            <View className="flex-row items-center rounded-2xl bg-silver-100 px-3 h-11">
              <Ionicons name="search" size={16} color="#71717A" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Short code, city, or move type"
                placeholderTextColor="#A1A1AA"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 ml-2 text-sm text-ink-900"
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color="#A1A1AA" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
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
        {isLoading && !bookings ? (
          <View className="py-12 items-center">
            <ActivityIndicator color="#16A34A" />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="cube-outline"
            title="No bookings match"
            body={
              search
                ? 'Try a different short code or city.'
                : tab === 'All'
                ? 'No bookings yet — come back once customers start moving.'
                : `Nothing in the ${tab} bucket right now.`
            }
            actionLabel={isRefetching ? undefined : 'Refresh'}
            onAction={() => refetch()}
          />
        ) : (
          filtered.map((b: any) => (
            <View key={b.id} className="mb-3">
              <Card>
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-ink-900">#{b.short_code}</Text>
                  <Badge
                    label={b.status.replace(/_/g, ' ')}
                    tone={
                      b.status === 'completed'
                        ? 'neutral'
                        : b.status === 'cancelled' || b.status === 'failed'
                        ? 'danger'
                        : 'success'
                    }
                  />
                </View>
                <Text className="text-sm text-ink-900 mt-2">
                  {b.pickup_city ?? '—'} → {b.dropoff_city ?? 'in-home'}
                </Text>
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="text-xs text-silver-500">
                    {fmtDateShort(b.scheduled_for_date)} · {b.move_type?.replace(/_/g, ' ')}
                  </Text>
                  <Text className="text-sm font-bold text-ink-900">
                    {fmtCurrency((b.price_total_cents ?? 0) / 100)}
                  </Text>
                </View>
                <View className="mt-3 flex-row gap-2">
                  <Pressable
                    onPress={() => onReassign(b)}
                    className="flex-1 h-10 rounded-2xl bg-silver-100 items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={`Reassign booking ${b.short_code}`}
                    disabled={reassign.isPending || ['completed', 'cancelled', 'failed'].includes(b.status)}
                    style={{
                      opacity:
                        reassign.isPending || ['completed', 'cancelled', 'failed'].includes(b.status) ? 0.4 : 1,
                    }}
                  >
                    <Text className="text-xs font-semibold text-ink-900">Reassign</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onRefund(b)}
                    className="flex-1 h-10 rounded-2xl bg-ink-900 items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel and refund booking ${b.short_code}`}
                    disabled={cancel.isPending || ['completed', 'cancelled', 'failed'].includes(b.status)}
                    style={{
                      opacity:
                        cancel.isPending || ['completed', 'cancelled', 'failed'].includes(b.status) ? 0.4 : 1,
                    }}
                  >
                    <Text className="text-xs font-semibold text-white">Cancel + refund</Text>
                  </Pressable>
                </View>
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      {/* Cross-platform reassign prompt (replaces iOS-only Alert.prompt). */}
      <PromptSheet
        visible={!!reassignTarget}
        title="Reassign booking"
        message={reassignTarget ? `Paste the driver, team, or company UUID to take #${reassignTarget.short_code}.` : ''}
        fields={[{ key: 'partner_id', label: 'Partner UUID', placeholder: 'driver / team / company UUID', required: true }]}
        confirmLabel="Reassign"
        onSubmit={submitReassign}
        onClose={() => setReassignTarget(null)}
      />
    </SafeAreaView>
  );
}
