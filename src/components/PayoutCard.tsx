// =============================================================================
// PayoutCard — what the crew can withdraw, and the button that asks for it.
//
// Movvy pays by hand, so this is a request. The card has to answer three
// questions without anyone having to ask support: how much can I take, what's
// still coming, and where is the money I already asked for.
//
// Admin-only by design — the org admin owns the banking relationship, and crew
// are paid a wage by their admin rather than per move, so they never see these
// figures at all.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { fmtCurrency, fmtDateShort } from '@/lib/format';
import {
  useCancelPayoutRequest,
  usePayoutSummary,
  useRequestPayout,
  type PayoutMethod,
} from '@/lib/data/usePayouts';

/** "Monday, August 17" from a YYYY-MM-DD string.
 *  Parsed part-by-part on purpose: new Date('2026-08-17') is UTC midnight,
 *  which formats as the 16th in every North American timezone. */
function fmtWeekday(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function PayoutCard() {
  const { data: s, isLoading } = usePayoutSummary();
  const request = useRequestPayout();
  const cancel = useCancelPayoutRequest();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Nothing to show while loading, or for someone with no org at all.
  if (isLoading || !s || !s.company_id) return null;

  // A crew member doesn't see the balance — payouts belong to the org and
  // settle to the admin's banking details. Say that plainly rather than
  // rendering nothing: a crew member who opens their profile and finds no
  // mention of pay assumes the app is broken, and asks their admin, who asks
  // us. One sentence removes the whole support thread.
  if (!s.can_view) {
    return (
      <View className="rounded-3xl bg-white dark:bg-night-100 p-5 border border-silver-100">
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Payouts
        </Text>
        <Text className="mt-2 text-sm text-silver-600 leading-5">
          Your crew admin handles payouts for the whole crew — earnings and tips
          are paid out to them, and they settle up with you.
        </Text>
      </View>
    );
  }

  const open = s.open_request;

  const ask = (method: PayoutMethod) => {
    setBusy(true);
    request
      .mutateAsync(method)
      .then((res) => {
        haptic.success();
        toast.success(`Requested ${fmtCurrency(res.amount_cents / 100)} — we'll send it shortly`);
      })
      .catch((e: any) => {
        haptic.error();
        // The server's messages are already written for a human, including the
        // "add your e-Transfer email first" case — so offer the fix, not a retry.
        const msg = e?.message ?? 'Could not request a payout.';
        if (msg.toLowerCase().includes('bank details')) {
          Alert.alert('Payment details needed', `${msg}\n\nProfile → Bank details.`, [
            { text: 'Not now', style: 'cancel' },
            // Bank details live in a sheet on the profile tab, not its own
            // route — send them to the tab and name the row they're looking for.
            {
              text: 'Open profile',
              onPress: () => router.push('/(company)/(tabs)/profile' as any),
            },
          ]);
        } else {
          Alert.alert('Could not request a payout', msg);
        }
      })
      .finally(() => setBusy(false));
  };

  const choose = () => {
    Alert.alert(
      `Withdraw ${fmtCurrency(s.available_cents / 100)}`,
      'How should we send it?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Interac e-Transfer', onPress: () => ask('etransfer') },
        { text: 'Bank deposit', onPress: () => ask('bank') },
      ],
    );
  };

  const confirmCancel = () => {
    if (!open) return;
    Alert.alert(
      'Cancel this request?',
      `${fmtCurrency(open.amount_cents / 100)} goes back to your balance. Requests reopen on Monday — if today is Monday you can ask again straight away.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () =>
            cancel
              .mutateAsync(open.id)
              .then(() => toast.success('Request cancelled'))
              .catch((e: any) => toast.error(e?.message ?? 'Could not cancel that.')),
        },
      ],
    );
  };

  // Why the button is off, in the order a crew would ask. null = enabled.
  const nextDay = s.next_request_day ? fmtWeekday(s.next_request_day) : null;
  const blockedReason = !s.is_request_day
    ? `Payouts are requested on Mondays.${nextDay ? ` Next one: ${nextDay}.` : ''}`
    : s.requested_this_week
      ? "You've already requested this week — the next one opens next Monday."
      : s.available_cents <= 0
        ? 'Nothing ready yet. A move becomes payable the second Monday after it finishes.'
        : null;

  return (
    <View className="mb-4">
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          {s.is_request_day ? 'Available to withdraw' : 'Ready for Monday'}
        </Text>
        <Text className="mt-1 text-3xl font-bold text-ink-900">
          {fmtCurrency(s.available_cents / 100)}
        </Text>

        {/* Payouts run weekly (0109): requests open on Mondays, and cover moves
            finished before the PREVIOUS Monday. in_hold_cents is money already
            earned and collected whose move is too recent for this week's window
            — it is NOT part of the figure above, so say so plainly rather than
            letting a crew think their balance is short. */}
        {s.in_hold_cents > 0 ? (
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            {fmtCurrency(s.in_hold_cents / 100)} from recent moves joins a later
            week — payouts cover moves finished before the previous Monday.
          </Text>
        ) : null}



        {s.tips_cents > 0 ? (
          <Text className="mt-1 text-xs text-brand-700">
            includes {fmtCurrency(s.tips_cents / 100)} in tips — yours in full
          </Text>
        ) : null}

        {s.penalties_cents > 0 ? (
          <Text className="mt-1 text-xs text-danger">
            −{fmtCurrency(s.penalties_cents / 100)} in late-release charges deducted
          </Text>
        ) : null}

        {/* ── Already asked ─────────────────────────────────────────────── */}
        {open ? (
          <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4">
            <View className="flex-row items-center">
              <Ionicons name="hourglass-outline" size={16} color="#B45309" />
              <Text className="ml-2 flex-1 text-sm font-bold text-ink-900">
                {fmtCurrency(open.amount_cents / 100)} requested
              </Text>
            </View>
            <Text className="mt-1 text-xs text-silver-600 leading-5">
              Sent by {open.method === 'etransfer' ? 'Interac e-Transfer' : 'bank deposit'} once
              Movvy processes it. Requested {fmtDateShort(open.created_at)}.
            </Text>
            {open.status === 'pending' ? (
              <Pressable onPress={confirmCancel} className="mt-2">
                <Text className="text-xs font-semibold text-silver-500">Cancel request</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {/* The button is always here, just disabled off-cycle, with the
                reason underneath. A control that vanishes reads as a bug — a
                crew looking for their money finds no button and assumes the app
                is broken, rather than learning when payday is. */}
            <Pressable
              onPress={choose}
              disabled={busy || !!blockedReason}
              className={`mt-4 h-12 rounded-2xl items-center justify-center flex-row ${
                busy || blockedReason ? 'bg-silver-200' : 'bg-brand-600 active:opacity-90'
              }`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name="cash-outline"
                    size={16}
                    color={blockedReason ? '#A1A1AA' : '#fff'}
                  />
                  <Text
                    className={`ml-2 text-sm font-bold ${
                      blockedReason ? 'text-silver-400' : 'text-white'
                    }`}
                  >
                    Request payout
                  </Text>
                </>
              )}
            </Pressable>

            {blockedReason ? (
              <Text className="mt-2 text-xs text-silver-500 leading-5 text-center">
                {blockedReason}
              </Text>
            ) : null}
          </>
        )}

        {s.lifetime_paid_cents > 0 ? (
          <Text className="mt-3 text-xs text-silver-400">
            {fmtCurrency(s.lifetime_paid_cents / 100)} paid out to date
          </Text>
        ) : null}
      </Card>
    </View>
  );
}
