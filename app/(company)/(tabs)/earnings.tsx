import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { fmtCurrency, fmtDateShort } from '@/lib/format';
import { useMyMembership, useCompanyEarningsSummary, useReleasePenalties } from '@/lib/data';
import { EarningsExportSheet } from '@/components/EarningsExportSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { PayoutCard } from '@/components/PayoutCard';
import { Skeleton } from '@/components/Skeleton';

// =============================================================================
// /(company)/(tabs)/earnings — real driver_payouts data, scoped by company_id.
//
// Replaced the entire fabricated set ("mockEarnings.month * 3.4", "+34%",
// "128 jobs", "$290 avg", hardcoded top-driver names). Numbers + the
// top-earning-drivers list are computed from the same payouts table the
// export sheet uses — what the owner sees here exactly matches what their
// drivers see in their Earnings tabs.
// =============================================================================

export default function CompanyEarnings() {
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const { data: earnings, isLoading } = useCompanyEarningsSummary(companyId);
  const { data: penalties } = useReleasePenalties(companyId);
  const penaltyTotalCents = (penalties ?? []).reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);
  const [exportOpen, setExportOpen] = useState(false);

  // Month-over-month delta — hidden when last month was $0 so we don't show
  // a meaningless "+∞%" jump on a fresh company.
  const mom =
    earnings && earnings.previousMonthCents > 0
      ? Math.round(
          ((earnings.monthCents - earnings.previousMonthCents) /
            earnings.previousMonthCents) *
            100,
        )
      : null;

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Earnings"
          showBack={false}
          right={
            <View className="flex-row items-center gap-2">
              <NotificationBell href="/(company)/notifications" />
              {companyId ? (
                <Pressable
                  onPress={() => setExportOpen(true)}
                  hitSlop={8}
                  className="h-9 px-3 rounded-full bg-silver-100 flex-row items-center active:opacity-80"
                >
                  <Ionicons name="document-text-outline" size={14} color="#0A0A0A" />
                  <Text className="ml-1 text-xs font-bold text-ink-900">Export</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* What's withdrawable, and the request button. Renders nothing for crew
            — they're paid a wage by their admin, not per move. */}
        <PayoutCard />
        <View className="rounded-3xl bg-ink-900 p-6">
          <Text className="text-white/70 text-xs uppercase font-semibold tracking-wider">
            This month
          </Text>
          {isLoading && !earnings ? (
            <View style={{ marginTop: 8 }}>
              <Skeleton width="55%" height={44} />
            </View>
          ) : (
            <Text className="text-white text-5xl font-bold mt-1">
              {fmtCurrency((earnings?.monthCents ?? 0) / 100)}
            </Text>
          )}
          {mom !== null ? (
            <View className="mt-3 flex-row items-center">
              <Ionicons
                name={mom >= 0 ? 'trending-up' : 'trending-down'}
                size={14}
                color={mom >= 0 ? '#34D399' : '#F87171'}
              />
              <Text
                className={`ml-1 text-xs font-semibold ${
                  mom >= 0 ? 'text-brand-300' : 'text-red-300'
                }`}
              >
                {mom >= 0 ? '+' : ''}
                {mom}% vs last month
              </Text>
            </View>
          ) : (
            <Text className="mt-3 text-xs text-white/70">
              {(earnings?.monthCents ?? 0) === 0
                ? 'No completed moves this month yet'
                : 'Tracking against last month'}
            </Text>
          )}
        </View>

        {/* Late-release penalties — a flat $100 each
            time a move was handed back with under 2 days' notice. Shown as
            negative lines tied to the booking so the cost of a late release is
            never a mystery on the statement. */}
        {(penalties?.length ?? 0) > 0 ? (
          <View className="mt-4 rounded-3xl border border-red-100 bg-red-50 p-5">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-xs font-semibold uppercase tracking-wider text-danger">
                  Late-release penalties
                </Text>
                <Text className="mt-1 text-xs text-silver-600 leading-4">
                  Released a move less than 2 days before the customer's date —
                  A flat $100 each.
                </Text>
              </View>
              <Text className="text-2xl font-bold text-danger">
                −{fmtCurrency(penaltyTotalCents / 100)}
              </Text>
            </View>

            <View className="mt-3 h-px bg-red-100" />
            {(penalties ?? []).map((p) => (
              <View key={p.id} className="mt-3 flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-semibold text-ink-900">
                    {p.short_code ? `#${p.short_code}` : 'Released move'}
                  </Text>
                  <Text className="text-[11px] text-silver-500 mt-0.5">
                    {fmtDateShort(p.created_at)}
                  </Text>
                </View>
                <Text className="text-sm font-bold text-danger">
                  −{fmtCurrency((p.amount_cents ?? 0) / 100)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-4 flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Jobs</Text>
            {isLoading && !earnings ? (
              <View style={{ marginTop: 6 }}>
                <Skeleton width="40%" height={22} />
              </View>
            ) : (
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {earnings?.monthJobCount ?? 0}
              </Text>
            )}
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Avg payout</Text>
            {isLoading && !earnings ? (
              <View style={{ marginTop: 6 }}>
                <Skeleton width="50%" height={22} />
              </View>
            ) : (
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency((earnings?.avgPayoutCents ?? 0) / 100)}
              </Text>
            )}
          </Card>
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
          Top earning drivers
        </Text>
        {(earnings?.topDrivers.length ?? 0) === 0 ? (
          <Card>
            <Text className="text-sm font-semibold text-ink-900">
              No driver payouts this month
            </Text>
            <Text className="text-xs text-silver-500 mt-1 leading-4">
              The top-earning drivers list fills in once your fleet starts
              completing moves this month.
            </Text>
          </Card>
        ) : (
          <Card padded={false}>
            {(earnings?.topDrivers ?? []).map((d, i, arr) => (
              <View
                key={d.profileId}
                className={`flex-row items-center px-5 py-4 ${
                  i < arr.length - 1 ? 'border-b border-silver-100' : ''
                }`}
              >
                <View className="h-8 w-8 rounded-full bg-silver-100 items-center justify-center">
                  <Text className="text-xs font-bold text-ink-900">#{i + 1}</Text>
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink-900" numberOfLines={1}>
                    {d.fullName}
                  </Text>
                  <Text className="text-xs text-silver-500">
                    {d.tripCount} {d.tripCount === 1 ? 'trip' : 'trips'}
                  </Text>
                </View>
                <Text className="text-base font-bold text-ink-900">
                  {fmtCurrency(d.netCents / 100)}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Tax-season statement — fleet-wide PDF + CSV pulled from
            driver_payouts. */}
        <Pressable
          onPress={() => setExportOpen(true)}
          disabled={!companyId}
          className="mt-6 rounded-2xl bg-white border border-silver-200 p-4 flex-row items-center active:opacity-80"
        >
          <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
            <Ionicons name="document-text" size={18} color="#047857" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink-900">Tax-season statement</Text>
            <Text className="text-[11px] text-silver-500 mt-0.5">
              Year-end PDF + CSV across every driver in your fleet
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
        </Pressable>
      </ScrollView>

      <EarningsExportSheet
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        partnerName={membership?.company_name ?? 'Movvy company'}
        companyId={companyId ?? undefined}
      />
    </SafeAreaView>
  );
}
