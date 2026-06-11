// =============================================================================
// /(customer)/support/audit/[id] — view + export the booking's audit chain
//
// Renders the chain of events for one booking with the SHA-256 chain hash
// at the bottom. "Download PDF" runs the same data through buildAuditHtml +
// expo-print so the customer gets a tamper-evident document.
// =============================================================================

import React, { useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  useBooking,
  useBookingAuditLog,
  useBookingAuditHash,
  useProfile,
} from '@/lib/data';
import { useToast } from '@/components/Toast';
import { fmtDateLong, fmtTime } from '@/lib/format';
import { shareAuditPdf } from '@/lib/auditExport';

export default function AuditView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking } = useBooking(id);
  const { data: rows, isLoading } = useBookingAuditLog(id);
  const { data: chainHash } = useBookingAuditHash(id);
  const { data: profile } = useProfile();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!booking || !profile) return;
    setDownloading(true);
    try {
      await shareAuditPdf({
        bookingShortCode: booking.short_code,
        bookingId: booking.id,
        customerName: profile.full_name ?? 'Movvy customer',
        customerEmail: profile.email ?? undefined,
        pickup: `${booking.pickup_line1}, ${booking.pickup_city}`,
        dropoff: booking.dropoff_line1
          ? `${booking.dropoff_line1}, ${booking.dropoff_city ?? ''}`
          : 'In-home (no drop-off)',
        scheduledForDate: booking.scheduled_for_date,
        rows: rows ?? [],
        chainHash: chainHash ?? null,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate the PDF.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Audit log"
          subtitle={booking ? `#${booking.short_code}` : undefined}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {isLoading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color="#16A34A" />
          </View>
        ) : !rows || rows.length === 0 ? (
          <Card>
            <Text className="text-sm font-bold text-ink-900">No audit events yet</Text>
            <Text className="mt-1 text-xs text-silver-500">
              The chain populates as your move moves through statuses. Come
              back once your crew is en route or your move is complete.
            </Text>
          </Card>
        ) : (
          <>
            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                {rows.length} {rows.length === 1 ? 'event' : 'events'} recorded
              </Text>
              {chainHash ? (
                <Text className="mt-2 text-[10px] text-silver-500 leading-4">
                  Chain hash:
                  {'\n'}
                  <Text className="font-mono text-ink-900">{chainHash.slice(0, 64)}</Text>
                </Text>
              ) : null}
            </Card>

            {rows.map((r) => (
              <View key={r.id} className="mt-3">
                <Card>
                  <View className="flex-row items-start">
                    <View className="h-7 w-7 rounded-full bg-silver-100 items-center justify-center">
                      <Ionicons name="time-outline" size={14} color="#0A0A0A" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900">
                        {fmtAction(r.action)}
                      </Text>
                      <Text className="text-[11px] text-silver-500 mt-0.5">
                        {fmtDateLong(r.created_at)} · {fmtTime(r.created_at)}
                      </Text>
                      <Text className="text-[10px] text-silver-400 mt-0.5">
                        {r.actor_role ?? 'system'} · {r.entity_type}#{r.id}
                      </Text>
                      {r.payload && Object.keys(r.payload).length > 0 ? (
                        <Text className="mt-2 text-[10px] font-mono text-silver-600 leading-4">
                          {JSON.stringify(r.payload, null, 2)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-3 border-t border-silver-100 bg-white"
        style={{ paddingBottom: 28 }}
      >
        <Button
          label="Download tamper-evident PDF"
          size="lg"
          fullWidth
          loading={downloading}
          disabled={!rows || rows.length === 0}
          onPress={download}
        />
        <Text className="mt-2 text-[10px] text-silver-500 text-center leading-4">
          Includes every event + the SHA-256 chain hash. Movvy can re-verify
          the hash later if this document ends up in a legal dispute.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function fmtAction(action: string): string {
  return action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
