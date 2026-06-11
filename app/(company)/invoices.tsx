// =============================================================================
// /(company)/invoices — payout history
//
// Reads driver_payouts rows scoped to the current company. Each row is one
// completed booking; status flips pending → processing → paid (or failed)
// as Movvy's weekly batch runs. Until Stripe Connect is wired this is
// the source of truth for what Movvy owes the company.
// =============================================================================

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { useMyMembership, useCompanyPayouts } from '@/lib/data';
import { NotificationBell } from '@/components/NotificationBell';
import { fmtCurrency } from '@/lib/format';
import { supabaseConfigured } from '@/lib/supabase';

function statusTone(s: string): 'neutral' | 'warning' | 'success' | 'danger' {
  if (s === 'paid') return 'success';
  if (s === 'processing') return 'warning';
  if (s === 'failed') return 'danger';
  return 'neutral';
}

export default function CompanyInvoices() {
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const { data: payouts, isLoading, refetch, isRefetching } = useCompanyPayouts(companyId);

  const totalPaid =
    payouts?.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.net_cents ?? 0), 0) ??
    0;
  const totalPending =
    payouts
      ?.filter((p) => p.status === 'pending' || p.status === 'processing')
      .reduce((s, p) => s + (p.net_cents ?? 0), 0) ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Invoices"
          subtitle={membership?.company_name ?? undefined}
          showBack
          right={<NotificationBell href="/(company)/notifications" />}
        />
      </View>

      {isLoading && !payouts ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={4} />
        </ScrollView>
      ) : !supabaseConfigured ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase to load your payout history."
        />
      ) : !payouts || payouts.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No invoices yet"
          body="Once your crews complete moves, every payout shows up here with a downloadable receipt."
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
              <Text className="text-xs text-silver-500 uppercase font-semibold">Paid out</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency(totalPaid / 100)}
              </Text>
              <Text className="mt-1 text-[11px] text-silver-500">Lifetime</Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Pending</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency(totalPending / 100)}
              </Text>
              <Text className="mt-1 text-[11px] text-silver-500">Next batch</Text>
            </Card>
          </View>

          {payouts.map((p) => {
            const code = p.booking?.short_code ?? '—';
            const dateStr = p.paid_at
              ? `Paid ${new Date(p.paid_at).toLocaleDateString()}`
              : p.scheduled_for
              ? `Scheduled ${new Date(p.scheduled_for).toLocaleDateString()}`
              : `Created ${new Date(p.created_at).toLocaleDateString()}`;
            return (
              <View key={p.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <View className="h-11 w-11 rounded-2xl bg-silver-100 items-center justify-center">
                      <Ionicons name="receipt-outline" size={20} color="#0A0A0A" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-bold text-ink-900">{code}</Text>
                      <Text className="text-xs text-silver-500 mt-0.5">{dateStr}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-base font-bold text-ink-900">
                        {fmtCurrency((p.net_cents ?? 0) / 100)}
                      </Text>
                      <Badge label={p.status} tone={statusTone(p.status)} />
                    </View>
                  </View>
                  <View className="mt-3 pt-3 border-t border-silver-100 flex-row justify-between">
                    <View>
                      <Text className="text-[11px] text-silver-500">Gross</Text>
                      <Text className="text-sm font-semibold text-ink-900 mt-0.5">
                        {fmtCurrency((p.gross_cents ?? 0) / 100)}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[11px] text-silver-500">Movvy fee</Text>
                      <Text className="text-sm font-semibold text-ink-900 mt-0.5">
                        −{fmtCurrency((p.movvy_margin_cents ?? 0) / 100)}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[11px] text-silver-500">Net to you</Text>
                      <Text className="text-sm font-bold text-brand-700 mt-0.5">
                        {fmtCurrency((p.net_cents ?? 0) / 100)}
                      </Text>
                    </View>
                  </View>
                </Card>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
