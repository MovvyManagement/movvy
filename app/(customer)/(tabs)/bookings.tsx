import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { mockBookings } from '@/data/mockBookings';
import { withMockFallback } from '@/lib/mocks';
import { fmtDateShort, fmtCurrency } from '@/lib/format';
import { useBookings, useActiveBooking, useProfile, useUnreadNotificationCount } from '@/lib/data';
import { NotificationBell } from '@/components/NotificationBell';
import { supabaseConfigured } from '@/lib/supabase';
import type { BookingStatus } from '@/types';
import LiveMove from '../live';
import { TipSheet, isInTipWindow } from '@/components/TipSheet';
import { ChatSheet } from '@/components/ChatSheet';
import { useToast } from '@/components/Toast';
import { CardSkeleton } from '@/components/Skeleton';
import { shareReceiptPdf } from '@/lib/printReceipt';
import { bookingToReceiptData } from '@/lib/receiptFromBooking';

/** True while the booking is still >24h out — mirrors the server-side
 *  cutoff in bookings-modify. UI hides the "Modify" button once the
 *  window closes; the edge fn rejects late attempts as a backstop. */
function isModifiable(scheduledDate: string | null | undefined): boolean {
  if (!scheduledDate) return false;
  const startMs = new Date(scheduledDate + 'T00:00:00').getTime();
  return startMs - Date.now() >= 24 * 60 * 60 * 1000;
}

/** True when scheduled_for_date is within the next 24h. Used to unlock the
 *  "Message crew" button on Upcoming cards a day ahead — so the customer
 *  can confirm parking, building access, etc. before the crew arrives. */
function isInChatWindow(scheduledDate: string | null | undefined): boolean {
  if (!scheduledDate) return false;
  const scheduled = new Date(scheduledDate + 'T00:00:00').getTime();
  const ms = scheduled - Date.now();
  return ms >= -2 * 60 * 60 * 1000 && ms <= 24 * 60 * 60 * 1000;
}

const tabs = ['Active', 'Upcoming', 'Completed'] as const;

function isActive(s: BookingStatus) {
  return ['on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'].includes(s);
}
function isUpcoming(s: BookingStatus) {
  // 'draft' is deliberately excluded: a draft only exists for the seconds
  // between "Pay deposit" and the sheet resolving (then it's either flipped
  // live by the webhook or cancelled) — it never renders as a move.
  return ['pending', 'searching', 'assigned', 'confirmed'].includes(s);
}

// =============================================================================
// Moves tab — the one place a customer goes for everything booking-related.
//
// • If there's an ACTIVE in-flight move → render the live tracker (LiveMove),
//   which bundles map + ETA + status + chat-with-crew + cancel / report.
//   This is how chat & tracking are reached now that they're not separate tabs.
//
// • Otherwise → show the upcoming / completed list (history).
//
// Reviews are NOT collected here — they auto-pop as a modal (ReviewPromptHost
// mounted at the layout level) the moment the driver flags drop-off complete.
// =============================================================================

export default function Bookings() {
  const { data: active } = useActiveBooking();

  // Active move? Hand the screen over to the live tracker.
  if (active) {
    return <LiveMove />;
  }

  return <BookingHistory />;
}

function BookingHistory() {
  // Initial chip selection:
  // • Caller can pass ?tab=completed / upcoming / active to deep-link
  //   straight into that section. The profile "Move history" row uses this
  //   so the customer lands on Completed, not Upcoming.
  // • Default is Upcoming for parity with the previous behaviour.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const initial: (typeof tabs)[number] =
    tabParam === 'completed'
      ? 'Completed'
      : tabParam === 'active'
      ? 'Active'
      : 'Upcoming';
  const [tab, setTab] = useState<(typeof tabs)[number]>(initial);
  const { data: live, isLoading, refetch, isRefetching } = useBookings();

  // Tip-sheet state — opens for a single completed booking at a time.
  const [tipTarget, setTipTarget] = useState<
    | { id: string; shortCode: string; totalDollars: number; tipCents: number }
    | null
  >(null);

  // Chat-sheet state — opens for an Upcoming booking that's within the 24h
  // pre-pickup window. Lets the customer confirm details with the crew the
  // day before, not just during the move itself.
  const [chatBookingId, setChatBookingId] = useState<string | null>(null);

  // In-app PDF receipt — renders the booking to a real PDF on-device and
  // opens the share sheet so the customer can save to Files, AirDrop to their
  // accountant, or email it themselves. No server round-trip, no email
  // gateway — accountants get real PDFs the moment the move completes.
  const { data: profile } = useProfile();
  const toast = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadReceipt = async (bookingId: string) => {
    if (!profile) {
      toast.error('Sign in to download your receipt.');
      return;
    }
    const row = (live ?? []).find((b) => b.id === bookingId);
    if (!row) {
      toast.error('Receipt unavailable — refresh and try again.');
      return;
    }
    setDownloadingId(bookingId);
    try {
      await shareReceiptPdf(bookingToReceiptData(row as any, profile));
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate the PDF. Try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Normalize live rows + mock rows to a common shape for the list.
  const rows = useMemo(() => {
    if (live && live.length > 0) {
      return live.map((b) => ({
        id: b.id,
        short: b.short_code,
        moveType: b.move_type,
        status: b.status,
        pickupLine: b.pickup_line1,
        pickupCity: b.pickup_city,
        dropoffLine: b.dropoff_line1 ?? '—',
        dropoffCity: b.dropoff_city ?? '',
        date: b.scheduled_for_date,
        timeWindow: b.scheduled_for_window ?? '',
        totalDollars: b.price_total_cents / 100,
        // Surface tip + completion timestamp so the row can decide whether
        // the 24h tip-window UI is still applicable.
        tipCents: (b as any).tip_cents ?? 0,
        completedAt: (b as any).completed_at as string | null,
      }));
    }
    // Dev-only fallback. In production this returns [] so the empty-state
    // UI kicks in. Set EXPO_PUBLIC_USE_MOCK_FALLBACKS=1 to opt back in.
    return withMockFallback<any>([], mockBookings).map((b: any) => ({
      id: b.id,
      short: b.id,
      moveType: b.moveType,
      status: b.status,
      pickupLine: b.pickup.line1,
      pickupCity: b.pickup.city,
      dropoffLine: b.dropoff.line1,
      dropoffCity: b.dropoff.city,
      date: b.date,
      timeWindow: b.timeWindow,
      totalDollars: b.total,
      tipCents: 0,
      completedAt: null as string | null,
    }));
  }, [live]);

  const list = rows.filter((b) => {
    if (tab === 'Active') return isActive(b.status);
    if (tab === 'Upcoming') return isUpcoming(b.status);
    return b.status === 'completed';
  });

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="My Moves" showBack={false} right={<NotificationBell />} />
        <View className="px-5 pb-4 flex-row gap-2">
          {tabs.map((t) => (
            <Chip key={t} label={t} selected={tab === t} onPress={() => setTab(t)} />
          ))}
        </View>
      </View>

      {isLoading && supabaseConfigured ? (
        // Card skeletons read 2× faster than a spinner-on-blank; users
        // perceive immediate response.
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={3} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#16A34A" />
          }
        >
          {list.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title={
                tab === 'Active'
                  ? 'No move in progress'
                  : tab === 'Upcoming'
                  ? 'No upcoming moves'
                  : 'No completed moves yet'
              }
              body={
                tab === 'Active'
                  ? "When a move is in progress, you'll see live tracking and a chat with your crew right here."
                  : 'Your moves will show up here once you book.'
              }
              actionLabel="Book a move"
              // Always send the customer to the home screen — they MUST
              // pick a pickup + drop-off there before the type chooser
              // makes sense. Letting them skip straight into /book/type
              // produced bookings without addresses; routing through
              // home guarantees the draft has coordinates first.
              onAction={() => router.push('/(customer)/home')}
            />
          ) : (
            list.map((b) => (
              <View key={b.id} className="mb-3">
                {/* History/upcoming cards are read-only — there's no longer a
                    standalone /track/[id] screen. The live tracker for the
                    active move is shown automatically at the top of this tab
                    when applicable. */}
                <Card>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-silver-500 uppercase">
                      {b.moveType.replace('_', ' ')}
                    </Text>
                    <Badge
                      label={b.status.replace(/_/g, ' ')}
                      tone={b.status === 'completed' ? 'neutral' : 'brand'}
                    />
                  </View>

                  <View className="mt-3 flex-row">
                    <View className="items-center mr-3">
                      <View className="h-3 w-3 rounded-full bg-ink-900" />
                      <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 18 }} />
                      <View className="h-3 w-3 rounded-full bg-brand-600" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-ink-900">{b.pickupLine}</Text>
                      <Text className="text-xs text-silver-500 mb-2">{b.pickupCity}</Text>
                      <Text className="text-sm font-semibold text-ink-900">{b.dropoffLine}</Text>
                      <Text className="text-xs text-silver-500">{b.dropoffCity}</Text>
                    </View>
                  </View>

                  <View className="h-px bg-silver-200 my-4" />

                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <Ionicons name="calendar-outline" size={14} color="#71717A" />
                      <Text className="ml-1 text-xs text-silver-500">
                        {fmtDateShort(b.date)} · {b.timeWindow}
                      </Text>
                    </View>
                    <Text className="text-sm font-bold text-ink-900">{fmtCurrency(b.totalDollars)}</Text>
                  </View>

                  {/* Modify booking — only shown while there's still >24h
                      until the move. Edge fn enforces the same cutoff
                      server-side; this is the visual gate. */}
                  {isUpcoming(b.status) && isModifiable(b.date) ? (
                    <Pressable
                      onPress={() => router.push(`/(customer)/modify/${b.id}`)}
                      className="mt-3 rounded-2xl bg-brand-50 border border-brand-100 p-3 flex-row items-center active:opacity-80"
                    >
                      <View className="h-8 w-8 rounded-full bg-brand-600 items-center justify-center">
                        <Ionicons name="create-outline" size={16} color="#fff" />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-bold text-ink-900">Modify booking</Text>
                        <Text className="text-[11px] text-silver-500 mt-0.5">
                          Change date, addresses, or notes · open up to 24h before
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#047857" />
                    </Pressable>
                  ) : null}

                  {/* Message crew — opens chat 24h before pickup so the
                      customer can confirm parking, access codes, etc. ahead
                      of time. Only shown for assigned/confirmed bookings to
                      avoid pre-match chat attempts. */}
                  {(b.status === 'assigned' || b.status === 'confirmed') &&
                  isInChatWindow(b.date) ? (
                    <Pressable
                      onPress={() => setChatBookingId(b.id)}
                      className="mt-3 rounded-2xl bg-silver-100 p-3 flex-row items-center active:opacity-80"
                    >
                      <View className="h-8 w-8 rounded-full bg-ink-900 items-center justify-center">
                        <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-bold text-ink-900">Message your crew</Text>
                        <Text className="text-[11px] text-silver-500 mt-0.5">
                          Confirm parking, entry codes, or special instructions
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#0A0A0A" />
                    </Pressable>
                  ) : null}

                  {/* Tip your crew — only on completed bookings within the
                      24h tipping window. Shows current tip (if any) and lets
                      the customer add/change/remove it. */}
                  {b.status === 'completed' && isInTipWindow(b.completedAt) ? (
                    <Pressable
                      onPress={() =>
                        setTipTarget({
                          id: b.id,
                          shortCode: b.short,
                          totalDollars: b.totalDollars,
                          tipCents: b.tipCents,
                        })
                      }
                      className="mt-3 rounded-2xl bg-brand-50 border border-brand-100 p-3 flex-row items-center active:opacity-80"
                    >
                      <View className="h-8 w-8 rounded-full bg-brand-600 items-center justify-center">
                        <Ionicons
                          name={b.tipCents > 0 ? 'cash' : 'cash-outline'}
                          size={16}
                          color="#fff"
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-bold text-ink-900">
                          {b.tipCents > 0
                            ? `Tipped $${(b.tipCents / 100).toFixed(0)}`
                            : 'Tip your crew'}
                        </Text>
                        <Text className="text-[11px] text-silver-500 mt-0.5">
                          {b.tipCents > 0
                            ? 'Tap to change or remove · 24h window'
                            : '100% goes to the crew · open for 24h'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#047857" />
                    </Pressable>
                  ) : null}

                  {/* PDF receipt — generated on-device the moment the move
                      completes and presented via the share sheet. Accountants
                      asked for real PDFs, not emails, so this is the only
                      receipt surface on completed cards. */}
                  {b.status === 'completed' ? (
                    <Pressable
                      onPress={() => downloadReceipt(b.id)}
                      disabled={downloadingId === b.id}
                      className="mt-3 rounded-2xl bg-ink-900 p-3 flex-row items-center active:opacity-90"
                    >
                      <View className="h-8 w-8 rounded-full bg-white/10 items-center justify-center">
                        <Ionicons
                          name={downloadingId === b.id ? 'hourglass-outline' : 'document-text'}
                          size={16}
                          color="#fff"
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-bold text-white">
                          {downloadingId === b.id ? 'Generating PDF…' : 'Download receipt (PDF)'}
                        </Text>
                        <Text className="text-[11px] text-white/70 mt-0.5">
                          Save to Files, AirDrop, or email — instant
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#fff" />
                    </Pressable>
                  ) : null}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Tip sheet — backed by tips-submit edge fn which enforces the 24h
          window server-side; this UI just hides itself when the window
          has expired (isInTipWindow). */}
      <TipSheet
        visible={!!tipTarget}
        bookingId={tipTarget?.id ?? ''}
        shortCode={tipTarget?.shortCode ?? ''}
        totalDollars={tipTarget?.totalDollars ?? 0}
        currentTipCents={tipTarget?.tipCents ?? 0}
        onClose={() => setTipTarget(null)}
      />

      {/* Pre-pickup chat sheet — opened from an Upcoming card within the
          24h window. Same ChatSheet component used during the live move. */}
      <ChatSheet
        visible={!!chatBookingId}
        bookingId={chatBookingId ?? ''}
        peerName="Your crew"
        onClose={() => setChatBookingId(null)}
      />
    </SafeAreaView>
  );
}
