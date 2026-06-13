// =============================================================================
// /(customer)/receipts — dedicated Receipts screen
//
// Every completed move's PDF receipt in one place. Movvy doesn't email
// receipts; this screen IS the receipt surface. Tapping a row generates
// the PDF on-device via expo-print and opens the native share sheet so
// the customer can save it to Files, AirDrop to their accountant, email
// it to themselves, or print it directly.
//
// Reachable from the customer Profile via the "Receipts" row.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { MaxWidth } from '@/components/MaxWidth';
import { useToast } from '@/components/Toast';
import { useBookings, useProfile } from '@/lib/data';
import { fmtDateLong, fmtCurrency } from '@/lib/format';
import { shareReceiptPdf } from '@/lib/printReceipt';
import { bookingToReceiptData } from '@/lib/receiptFromBooking';
import { track } from '@/lib/analytics';

export default function Receipts() {
  const { data: profile } = useProfile();
  const { data: bookings, isLoading, refetch, isRefetching } = useBookings();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Receipts only exist once a move is `completed`. Filter + sort newest first.
  const completed = useMemo(() => {
    return (bookings ?? [])
      .filter((b) => b.status === 'completed')
      .sort(
        (a, b) =>
          new Date(b.completed_at ?? b.scheduled_for_date).getTime() -
          new Date(a.completed_at ?? a.scheduled_for_date).getTime(),
      );
  }, [bookings]);

  const downloadReceipt = async (bookingId: string) => {
    if (!profile) {
      toast.error('Sign in to download your receipt.');
      return;
    }
    const row = completed.find((b) => b.id === bookingId);
    if (!row) {
      toast.error('Receipt unavailable — refresh and try again.');
      return;
    }
    setBusyId(bookingId);
    try {
      await shareReceiptPdf(bookingToReceiptData(row as any, profile));
      track('receipt_downloaded', { booking_id: bookingId, short_code: row.short_code });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate the PDF. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const totalSpentCents = completed.reduce(
    (sum, b) => sum + (b.price_total_cents ?? 0) + ((b as any).tip_cents ?? 0),
    0,
  );

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Receipts" subtitle="Save, AirDrop, email — all in PDF" showBack />
      </View>

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
        <MaxWidth>
          {/* Header card — receipts overview / explainer */}
          <Card>
            <View className="flex-row items-center">
              <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
                <Ionicons name="document-text" size={22} color="#047857" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base font-bold text-ink-900">
                  Your Movvy receipts
                </Text>
                <Text className="text-xs text-silver-500 mt-0.5 leading-5">
                  Movvy doesn't email receipts. They live here as real PDFs you
                  can save, AirDrop, or forward to your accountant any time.
                </Text>
              </View>
            </View>

            {/* Summary stats — only when there's at least one completed move. */}
            {completed.length > 0 ? (
              <View className="mt-4 flex-row gap-3">
                <View className="flex-1 rounded-2xl bg-silver-100 p-3">
                  <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                    Total Moves
                  </Text>
                  <Text className="mt-1 text-xl font-bold text-ink-900">
                    {completed.length}
                  </Text>
                </View>
                <View className="flex-1 rounded-2xl bg-silver-100 p-3">
                  <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                    Total Spent
                  </Text>
                  <Text className="mt-1 text-xl font-bold text-ink-900">
                    {fmtCurrency(totalSpentCents / 100)}
                  </Text>
                </View>
              </View>
            ) : null}
          </Card>

          {/* Receipts list */}
          {isLoading && !bookings ? (
            <View className="mt-4">
              <CardSkeleton count={3} />
            </View>
          ) : completed.length === 0 ? (
            <View className="mt-6">
              <EmptyState
                icon="document-text-outline"
                title="No receipts yet"
                body="Once your first move completes, the receipt PDF will appear here automatically."
              />
            </View>
          ) : (
            <View className="mt-4">
              {completed.map((b) => {
                const busy = busyId === b.id;
                const route = b.dropoff_line1
                  ? `${b.pickup_city ?? b.pickup_line1} → ${b.dropoff_city ?? b.dropoff_line1}`
                  : `${b.pickup_city ?? b.pickup_line1} · in-home`;
                const total = ((b.price_total_cents ?? 0) + ((b as any).tip_cents ?? 0)) / 100;
                return (
                  <View key={b.id} className="mb-3">
                    <Card>
                      {/* Top — date + total */}
                      <View className="flex-row items-start">
                        <View className="h-11 w-11 rounded-2xl bg-brand-50 items-center justify-center">
                          <Ionicons name="receipt" size={20} color="#047857" />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-base font-bold text-ink-900" numberOfLines={1}>
                            {fmtDateLong(b.completed_at ?? b.scheduled_for_date)}
                          </Text>
                          <Text className="text-xs text-silver-500 mt-0.5" numberOfLines={1}>
                            {route}
                          </Text>
                          <Text className="text-[11px] text-silver-400 mt-0.5">
                            Receipt #{b.short_code}
                          </Text>
                        </View>
                        <View className="items-end">
                          <Text className="text-base font-bold text-ink-900">
                            {fmtCurrency(total)}
                          </Text>
                          <Text className="text-[10px] text-silver-500 mt-0.5">CAD</Text>
                        </View>
                      </View>

                      {/* PDF action */}
                      <Pressable
                        onPress={() => downloadReceipt(b.id)}
                        disabled={busy}
                        className="mt-4 rounded-2xl bg-ink-900 p-3 flex-row items-center active:opacity-90"
                        accessibilityRole="button"
                        accessibilityLabel={`Download receipt for booking ${b.short_code}`}
                      >
                        <View className="h-8 w-8 rounded-full bg-white/10 items-center justify-center">
                          <Ionicons
                            name={busy ? 'hourglass-outline' : 'document-text'}
                            size={16}
                            color="#fff"
                          />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-sm font-bold text-white">
                            {busy ? 'Generating PDF…' : 'View / Save Receipt (PDF)'}
                          </Text>
                          <Text className="text-[11px] text-white/70 mt-0.5">
                            Opens share sheet · Files, AirDrop, email
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#fff" />
                      </Pressable>
                    </Card>
                  </View>
                );
              })}
            </View>
          )}

          {/* Bottom note — addresses the most common "where's my receipt email?" support thread */}
          <View className="mt-6 rounded-2xl bg-silver-100 p-4 flex-row">
            <Ionicons name="information-circle-outline" size={18} color="#71717A" />
            <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-5">
              Movvy generates receipts on-device the moment a move completes —
              nothing is sent over email. Each PDF is the official record for
              tax and accounting purposes. Need a tax ID we don't show yet?
              Email{' '}
              <Text className="font-bold text-ink-900">support@movvy.ca</Text>.
            </Text>
          </View>
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
