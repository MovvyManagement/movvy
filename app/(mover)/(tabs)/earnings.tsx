import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { fmtCurrency, fmtDateShort } from '@/lib/format';
import { useMyDriverStats } from '@/lib/data/usePartners';
import {
  useProfile,
  useMyMembership,
  useDriverEarningsSummary,
  useHoursWorked,
} from '@/lib/data';
import { EarningsExportSheet } from '@/components/EarningsExportSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuth } from '@/lib/supabase';
import { Skeleton } from '@/components/Skeleton';

// =============================================================================
// /(mover)/(tabs)/earnings — real driver_payouts data.
//
// Previously rendered hardcoded mockEarnings.week / .today / .month / daily
// bars / "Recent payouts" — a driver saw "$X this week" while their real
// payouts were $0, or worse, fake numbers attributed to them. Now every
// dollar shown comes from driver_payouts via useDriverEarningsSummary.
// Cold state (zero completed moves) keeps the welcome-panel copy that used
// to live here, so a fresh driver still feels invited rather than empty.
// =============================================================================

export default function MoverEarnings() {
  const { data: stats } = useMyDriverStats();
  const { data: profile } = useProfile();
  const { data: membership } = useMyMembership();
  const { user } = useAuth();
  const { data: earnings, isLoading } = useDriverEarningsSummary();

  const ratingText = stats?.rating_avg != null ? Number(stats.rating_avg).toFixed(1) : '—';
  const reviewCount = stats?.rating_count ?? 0;
  const tripCount = stats?.trip_count ?? 0;
  const [exportOpen, setExportOpen] = useState(false);

  // Hourly laborers (company drivers + team movers) are paid a wage by their
  // employer/operator — Movvy never processes their pay and they don't earn
  // per move. So this whole screen drops the dollar figures, payout history
  // and tax export, and shows the wage-model explainer + their rating instead.
  const isHourly = membership?.is_hourly ?? false;
  // Hours-per-day for the last two weeks — what an hourly crew member needs
  // instead of dollar figures.
  const hours = useHoursWorked(14);
  const employerName = membership?.company_name ?? membership?.team_name ?? 'your crew';

  // Solo driver / partner team / company — passed through to the export
  // sheet so the PDF / CSV scopes to the right recipient.
  const partnerName =
    stats?.team_name ?? profile?.full_name ?? 'Movvy Partner';

  // Cold state — driver has completed zero moves. Avoids "$0 / $0 / $0"
  // first-day impression and keeps the welcome copy that motivates them.
  const noEarnings = tripCount === 0;
  // Max bar value for the chart — guard against /0 when every day is zero.
  const maxBar = Math.max(...(earnings?.weekBars ?? [0]), 1);

  // Day-over-day delta on the Today tile. Hidden when yesterday was $0
  // (a "+∞%" delta is meaningless).
  const dod =
    earnings && earnings.yesterdayCents > 0
      ? Math.round(((earnings.todayCents - earnings.yesterdayCents) / earnings.yesterdayCents) * 100)
      : null;

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title={isHourly ? 'Pay' : 'Earnings'}
          showBack={false}
          right={
            <View className="flex-row items-center gap-2">
              <NotificationBell href="/(mover)/notifications" />
              {/* Tax-season export is a contractor feature — hourly workers
                  get a wage from their employer, not a Movvy payout statement. */}
              {!isHourly ? (
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
        {isHourly ? (
          // Hourly workers don't earn per move — show the wage model instead
          // of any dollar figures, bars, or payout history.
          // Hourly workers don't earn per move — they need their HOURS, not
          // dollars: time worked per day over the last two weeks, so they can
          // check it against the paycheque their crew admin issues.
          <>
            <View className="rounded-3xl bg-ink-900 p-6">
              <Text className="text-white/70 text-xs uppercase font-semibold tracking-wider">
                Last 2 weeks
              </Text>
              <Text className="text-white text-5xl font-bold mt-1">
                {(hours.data?.totalHours ?? 0).toFixed(1)}
                <Text className="text-2xl"> hrs</Text>
              </Text>
              <Text className="text-white/70 text-sm mt-3 leading-5">
                {hours.data?.totalMoves ?? 0}{' '}
                {(hours.data?.totalMoves ?? 0) === 1 ? 'move' : 'moves'} with {employerName}.
                You're on a wage — {employerName} handles your pay, so job prices
                don't apply to you. These are the hours Movvy recorded for you.
              </Text>
            </View>

            {/* Tips ARE the crew's money, so unlike job pricing they're shown.
                Paid out by the crew admin along with wages — labelled that way
                so nobody expects a separate Movvy deposit. */}
            {(hours.data?.totalTipCents ?? 0) > 0 ? (
              <View className="mt-3 rounded-3xl border border-brand-200 bg-brand-50 p-5">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                      Tips on your moves
                    </Text>
                    <Text className="mt-1 text-xs text-silver-600 leading-4">
                      Left by customers over the last two weeks · paid out by{' '}
                      {employerName} with your wages.
                    </Text>
                  </View>
                  <Text className="text-3xl font-bold text-ink-900">
                    {fmtCurrency((hours.data?.totalTipCents ?? 0) / 100)}
                  </Text>
                </View>
              </View>
            ) : null}

            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
              Hours by day
            </Text>
            {hours.isLoading ? (
              <Skeleton width="100%" height={72} />
            ) : (hours.data?.days.length ?? 0) === 0 ? (
              <Card>
                <Text className="text-sm font-semibold text-ink-900">No hours logged yet</Text>
                <Text className="text-xs text-silver-500 mt-1 leading-4">
                  Once you finish a move, the time you worked shows up here — day
                  by day for the last two weeks.
                </Text>
              </Card>
            ) : (
              hours.data!.days.map((d) => (
                <View key={d.date} className="mb-2">
                  <Card>
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="text-sm font-bold text-ink-900">
                          {fmtDateShort(d.date)}
                        </Text>
                        <Text className="text-xs text-silver-500 mt-0.5">
                          {d.moves} {d.moves === 1 ? 'move' : 'moves'}
                          {d.tipCents > 0 ? ` · ${fmtCurrency(d.tipCents / 100)} tips` : ''}
                        </Text>
                      </View>
                      <Text className="text-xl font-bold text-ink-900">
                        {d.hours.toFixed(1)}
                        <Text className="text-sm text-silver-500"> hrs</Text>
                      </Text>
                    </View>
                  </Card>
                </View>
              ))
            )}
          </>
        ) : noEarnings ? (
          // Cold-state hero — keeps the friendly onboarding copy intact for
          // drivers who haven't completed a move yet. No fake bars.
          <View className="rounded-3xl bg-ink-900 p-6">
            <Text className="text-white/70 text-xs uppercase font-semibold tracking-wider">
              This week
            </Text>
            <Text className="text-white text-5xl font-bold mt-1">$0</Text>
            <Text className="text-white/70 text-sm mt-3 leading-5">
              Your first payout shows here after Move #1. Get online from the
              Jobs tab — the moment you complete a move, your earnings start
              appearing here. Movvy keeps 17%; you get the rest, paid every
              Monday.
            </Text>
          </View>
        ) : (
          <View className="rounded-3xl bg-ink-900 p-6">
            <Text className="text-white/70 text-xs uppercase font-semibold tracking-wider">
              This week
            </Text>
            {isLoading && !earnings ? (
              <View style={{ marginTop: 8 }}>
                <Skeleton width="50%" height={44} />
              </View>
            ) : (
              <Text className="text-white text-5xl font-bold mt-1">
                {fmtCurrency((earnings?.weekCents ?? 0) / 100)}
              </Text>
            )}
            <Text className="text-white/70 text-xs mt-1">
              After Movvy's 17% service fee · Paid every Monday
            </Text>

            <View className="mt-6 flex-row items-end gap-2" style={{ height: 100 }}>
              {(earnings?.weekBars ?? Array(7).fill(0)).map((v, i) => (
                <View key={i} className="flex-1 items-center">
                  <View
                    className="w-full rounded-t-lg bg-brand-500"
                    style={{ height: (v / maxBar) * 80 || 4, opacity: v ? 1 : 0.3 }}
                  />
                  <Text className="text-white/70 text-xs mt-2">
                    {earnings?.weekLabels?.[i] ?? ''}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!isHourly ? (
        <View className="mt-4 flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Today</Text>
            {isLoading && !earnings ? (
              <View style={{ marginTop: 6 }}>
                <Skeleton width="60%" height={22} />
              </View>
            ) : (
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency((earnings?.todayCents ?? 0) / 100)}
              </Text>
            )}
            {dod !== null ? (
              <View className="mt-2 flex-row items-center">
                <Ionicons
                  name={dod >= 0 ? 'arrow-up' : 'arrow-down'}
                  size={14}
                  color={dod >= 0 ? '#16A34A' : '#EF4444'}
                />
                <Text
                  className={`ml-1 text-xs font-semibold ${
                    dod >= 0 ? 'text-success' : 'text-danger'
                  }`}
                >
                  {dod >= 0 ? '+' : ''}
                  {dod}% vs yesterday
                </Text>
              </View>
            ) : (
              <Text className="mt-2 text-xs text-silver-500">
                No earnings yesterday yet
              </Text>
            )}
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Month</Text>
            {isLoading && !earnings ? (
              <View style={{ marginTop: 6 }}>
                <Skeleton width="60%" height={22} />
              </View>
            ) : (
              <Text className="text-2xl font-bold text-ink-900 mt-1">
                {fmtCurrency((earnings?.monthCents ?? 0) / 100)}
              </Text>
            )}
            <Text className="mt-2 text-xs text-silver-500">
              {earnings?.monthTripCount ?? 0}{' '}
              {earnings?.monthTripCount === 1 ? 'completed move' : 'completed moves'}
            </Text>
          </Card>
        </View>
        ) : null}

        {/* Live rating — same number the customer & Movvy admin see */}
        <Card className="mt-4">
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="star" size={22} color="#16A34A" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">
                Customer rating
              </Text>
              <View className="flex-row items-baseline mt-1">
                <Text className="text-2xl font-bold text-ink-900">{ratingText}</Text>
                <Text className="text-sm text-silver-500"> / 5</Text>
              </View>
              <Text className="text-xs text-silver-500 mt-0.5">
                {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'} · {tripCount} completed{' '}
                {tripCount === 1 ? 'trip' : 'trips'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Tax-season export + payout history — contractor-only. Hourly
            workers are paid a wage by their employer, so neither applies. */}
        {!isHourly ? (
        <>
        <Pressable
          onPress={() => setExportOpen(true)}
          className="mt-6 rounded-2xl bg-white border border-silver-200 p-4 flex-row items-center active:opacity-80"
        >
          <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
            <Ionicons name="document-text" size={18} color="#047857" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink-900">Tax-season statement</Text>
            <Text className="text-[11px] text-silver-500 mt-0.5">
              PDF + CSV with every payout — drop straight into bookkeeping
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
        </Pressable>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
          Recent payouts
        </Text>
        {(earnings?.recent.length ?? 0) === 0 ? (
          <Card>
            <Text className="text-sm text-ink-900 font-semibold">No payouts yet</Text>
            <Text className="text-xs text-silver-500 mt-1 leading-4">
              Complete your first move and your payout history will start showing here.
            </Text>
          </Card>
        ) : (
          <Card padded={false}>
            {(earnings?.recent ?? []).map((p, i, arr) => (
              <View
                key={p.id}
                className={`flex-row items-center px-5 py-4 ${
                  i < arr.length - 1 ? 'border-b border-silver-100' : ''
                }`}
              >
                <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
                  <Ionicons name="cash-outline" size={20} color="#047857" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink-900">
                    {p.shortCode ? `Move #${p.shortCode}` : 'Movvy payout'}
                  </Text>
                  <Text className="text-xs text-silver-500">
                    Paid · {fmtDateShort(p.createdAt)}
                  </Text>
                </View>
                <Text className="text-base font-bold text-ink-900">
                  {fmtCurrency(p.netCents / 100)}
                </Text>
              </View>
            ))}
          </Card>
        )}
        </>
        ) : null}
      </ScrollView>

      {/* Export sheet — solo driver = use their own profile id; team member
          = roll up the team's payouts via team_id. */}
      <EarningsExportSheet
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        partnerName={partnerName}
        driverProfileId={
          membership?.kind === 'team' ? undefined : user?.id ?? undefined
        }
        teamId={membership?.kind === 'team' ? membership.team_id ?? undefined : undefined}
      />
    </SafeAreaView>
  );
}
