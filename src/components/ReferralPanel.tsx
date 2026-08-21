// =============================================================================
// ReferralPanel — the invite card, shared by the customer and crew screens.
//
// One component because the two sides differ only in the reward and the
// sentence describing what the invitee has to do. Duplicating it is how the
// crew screen ended up advertising "$100 each" long after the number changed —
// the copy has to come from the same place as the rule.
//
// The amounts here are DISPLAY ONLY. award_referral_credit (0110) decides what
// is actually paid, from what the invitee did rather than which screen shared
// the code, so a stale build can misquote the figure but can never change it.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, Share, Platform, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { fmtCurrency } from '@/lib/format';
import {
  useMyReferralCode,
  useMyReferralStats,
  useMyCreditBalance,
  useApplyReferralCode,
} from '@/lib/data';

/** Kept in step with award_referral_credit() in migration 0110. */
export const REFERRAL_REWARD_CENTS = { customer: 7500, driver: 5000 } as const;

export function ReferralPanel({ side }: { side: 'customer' | 'driver' }) {
  const toast = useToast();
  const { data: code, isLoading } = useMyReferralCode();
  const { data: stats } = useMyReferralStats();
  const { data: credit } = useMyCreditBalance();
  const apply = useApplyReferralCode();
  const [entered, setEntered] = useState('');

  const rewardCents = REFERRAL_REWARD_CENTS[side];
  const reward = fmtCurrency(rewardCents / 100);

  // What the invitee must actually do. This is the gate, stated plainly —
  // "invite a friend" with no qualifier is how referral programmes generate
  // support tickets from people who invited someone and saw nothing.
  const qualifier =
    side === 'customer'
      ? 'once they book and pay for their first move'
      : 'once they finish their first job';

  const shareText =
    side === 'customer'
      ? `I'm using Movvy for moving in Alberta. Use my code ${code ?? ''} and we each get ${reward} in credit once you book your first move. movvy.ca`
      : `Join me moving with Movvy. Use my code ${code ?? ''} when you sign up — we each get ${reward} in credit once you finish your first job. movvy.ca`;

  const copy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    haptic.success();
    toast.success('Code copied');
  };

  const share = async () => {
    if (!code) return;
    try {
      await Share.share(
        Platform.OS === 'ios' ? { message: shareText } : { message: shareText, title: 'Movvy' },
      );
    } catch {
      /* user dismissed the sheet — not an error */
    }
  };

  return (
    <View className="gap-4">
      {/* ── The credit they've actually earned ──────────────────────────────
          Reads the ledger, not the referrals table: this is money that exists,
          not what a referral would be worth if it qualified. */}
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Your credit
        </Text>
        <Text className="mt-1 text-3xl font-bold text-ink-900">
          {fmtCurrency((credit?.balance_cents ?? 0) / 100)}
        </Text>
        <Text className="mt-1 text-xs text-silver-500 leading-5">
          {(credit?.balance_cents ?? 0) > 0
            ? 'Movvy applies this against your account — contact support to use it on your next move.'
            : `Earn ${reward} for every person you invite, ${qualifier}.`}
        </Text>
      </Card>

      {/* ── The code ────────────────────────────────────────────────────── */}
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Your invite code
        </Text>
        <View className="mt-2 flex-row items-center">
          <View className="flex-1 rounded-2xl bg-silver-50 border border-silver-100 px-4 py-3">
            <Text className="text-2xl font-bold tracking-[3px] text-ink-900">
              {isLoading ? '·····' : code ?? '—'}
            </Text>
          </View>
          <Pressable
            onPress={copy}
            disabled={!code}
            className="ml-2 h-12 w-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-70"
            accessibilityLabel="Copy invite code"
          >
            <Ionicons name="copy-outline" size={18} color="#71717A" />
          </Pressable>
        </View>

        <Pressable
          onPress={share}
          disabled={!code}
          className="mt-3 h-12 rounded-2xl bg-brand-600 items-center justify-center flex-row active:opacity-90"
        >
          <Ionicons name="share-outline" size={16} color="#fff" />
          <Text className="ml-2 text-sm font-bold text-white">Share your code</Text>
        </Pressable>

        <Text className="mt-3 text-xs text-silver-500 leading-5">
          You both get <Text className="font-semibold text-ink-900">{reward}</Text> in
          credit {qualifier}. Nothing is paid before that.
        </Text>
      </Card>

      {/* ── Enter someone else's code ─────────────────────────────────────
          This card did not exist. The whole back half of the programme was
          built — ledger, award rules, triggers, collision-free codes — and
          there was no field anywhere in the app to type a code into, so not
          one referral was ever created. A share button with nothing on the
          receiving end is just a share button. */}
      {(stats?.referred_by ?? null) === null ? (
        <Card>
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            Got a code from someone?
          </Text>
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            Enter it before your first {side === 'customer' ? 'paid move' : 'job'} and you
            both get credit when it qualifies.
          </Text>
          <View className="mt-3 flex-row items-center">
            <View className="flex-1 rounded-2xl border border-silver-200 bg-white px-4 py-3">
              <TextInput
                value={entered}
                onChangeText={(t) => setEntered(t.toUpperCase())}
                placeholder="MOVXXXXX"
                placeholderTextColor="#A1A1AA"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                editable={!apply.isPending}
                className="text-base font-bold tracking-widest text-ink-900"
              />
            </View>
            <Pressable
              onPress={async () => {
                try {
                  await apply.mutateAsync(entered);
                  haptic.success();
                  toast.success("Code applied — credit lands when it qualifies.");
                  setEntered('');
                } catch (e: any) {
                  toast.error(e?.message ?? "That code couldn't be applied.");
                }
              }}
              // Every Movvy code is MOV + 4 or 5 characters. Gating on 7 stops
              // an obviously-incomplete submission without inventing a rule the
              // customer can't see — the placeholder shows the shape.
              disabled={apply.isPending || entered.trim().length < 7}
              className={`ml-2 rounded-2xl px-5 py-3.5 ${
                apply.isPending || entered.trim().length < 7 ? 'bg-silver-200' : 'bg-ink-900'
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  apply.isPending || entered.trim().length < 7 ? 'text-silver-500' : 'text-white'
                }`}
              >
                {apply.isPending ? 'Checking…' : 'Apply'}
              </Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {/* ── Where their invites are up to ───────────────────────────────── */}
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Your invites
        </Text>
        <View className="mt-3 flex-row">
          <Stat label="Invited" value={String(stats?.invited ?? 0)} />
          <Stat label="Qualified" value={String(stats?.applied ?? 0)} />
          <Stat
            label="Waiting"
            value={String(Math.max(0, (stats?.invited ?? 0) - (stats?.applied ?? 0)))}
          />
        </View>
        {(stats?.invited ?? 0) > (stats?.applied ?? 0) ? (
          <Text className="mt-3 text-xs text-silver-500 leading-5">
            &quot;Waiting&quot; means they signed up with your code but haven&apos;t{' '}
            {side === 'customer' ? 'booked and paid yet' : 'finished a job yet'}.
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-2xl font-bold text-ink-900">{value}</Text>
      <Text className="text-[11px] text-silver-500 mt-0.5">{label}</Text>
    </View>
  );
}
