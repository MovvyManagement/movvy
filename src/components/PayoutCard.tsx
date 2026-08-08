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

export function PayoutCard() {
  const { data: s, isLoading } = usePayoutSummary();
  const request = useRequestPayout();
  const cancel = useCancelPayoutRequest();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Crew don't see money. Neither does anyone without an org yet.
  if (isLoading || !s || !s.company_id || !s.is_org_admin) return null;

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
      `${fmtCurrency(open.amount_cents / 100)} goes back to your available balance. You can request it again any time.`,
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

  return (
    <View className="mb-4">
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Available to withdraw
        </Text>
        <Text className="mt-1 text-3xl font-bold text-ink-900">
          {fmtCurrency(s.available_cents / 100)}
        </Text>

        {s.clearing_cents > 0 ? (
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            {fmtCurrency(s.clearing_cents / 100)} clearing
            {s.next_available_at ? ` · available ${fmtDateShort(s.next_available_at)}` : ''}
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
        ) : s.available_cents > 0 ? (
          <Pressable
            onPress={choose}
            disabled={busy}
            className={`mt-4 h-12 rounded-2xl items-center justify-center flex-row ${
              busy ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cash-outline" size={16} color="#fff" />
                <Text className="ml-2 text-sm font-bold text-white">Request payout</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Text className="mt-3 text-xs text-silver-500 leading-5">
            Money from a completed move becomes available {s.hold_days} days after the customer
            pays. Nothing ready to withdraw yet.
          </Text>
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
