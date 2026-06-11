// =============================================================================
// /(mover)/referrals — driver-to-driver referral program
//
// Drivers (and movers) refer other drivers to onboard. When the referred
// driver completes their first 5 moves, both sides get a $100 credit
// applied to their next weekly payout.
//
// Reuses profile.referral_code from migration 0015 (it's per-profile, not
// per-customer, so the same code works for whichever side the driver is on).
//
// Backend reward logic is deferred to a future migration — for now the UI
// surfaces the code and the share flow, which is enough to start
// collecting referrals. Awards are computed manually in admin tooling
// until we ship a trigger.
// =============================================================================

import React from 'react';
import { View, Text, ScrollView, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useMyReferralCode, useMyReferralStats } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

const REWARD_DOLLARS = 100;
const COMPLETED_MOVES_THRESHOLD = 5;

export default function MoverReferrals() {
  const { data: code, isLoading } = useMyReferralCode();
  const { data: stats } = useMyReferralStats();
  const toast = useToast();

  const onShare = async () => {
    if (!code) return;
    haptic.success();
    try {
      await Share.share({
        message: `Drive with Movvy and earn — Alberta's fast-growing moving marketplace. Use my partner code ${code} when you onboard, complete your first ${COMPLETED_MOVES_THRESHOLD} moves, and we both get $${REWARD_DOLLARS} bonus. https://movvy.ca/p/${code}`,
        title: 'Drive with Movvy',
      });
    } catch {
      // user cancelled
    }
  };

  const onCopy = async () => {
    if (!code) return;
    haptic.light();
    try {
      await Clipboard.setStringAsync(code);
      toast.success(`Code "${code}" copied`);
    } catch {
      toast.error('Could not copy — try Share instead');
    }
  };

  // Map the customer-style stats hook's field names onto the driver-side
  // labels used below. accepted_count, pending_count, credit_earned_cents
  // were never on the response shape — the screen always showed 0 / 0 / $0
  // even after real referrals landed. The referrals table is shared, so the
  // numbers are correct; we just need the right keys.
  const accepted = stats?.applied ?? 0;
  const pending = Math.max(0, (stats?.invited ?? 0) - accepted);
  const earned = (stats?.creditsEarnedCents ?? 0) / 100;

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top', 'bottom']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Refer a driver" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Hero — bigger pitch than the customer version since driver
            referrals are higher-value and harder to source. */}
        <View className="rounded-3xl overflow-hidden mb-4">
          <LinearGradient
            colors={['#047857', '#16A34A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 24 }}
          >
            <View className="h-12 w-12 rounded-2xl bg-white/15 items-center justify-center">
              <Ionicons name="people" size={26} color="#fff" />
            </View>
            <Text className="mt-4 text-white text-2xl font-bold leading-7">
              Earn ${REWARD_DOLLARS} for every driver you bring in
            </Text>
            <Text className="mt-2 text-white/80 text-sm leading-5">
              They onboard with your code, complete {COMPLETED_MOVES_THRESHOLD} moves,
              and you both get a ${REWARD_DOLLARS} bonus on your next weekly payout.
            </Text>
          </LinearGradient>
        </View>

        {/* Code card */}
        <Card>
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            Your partner code
          </Text>
          {isLoading || !code ? (
            <Text className="mt-2 text-2xl font-bold text-silver-300">·····</Text>
          ) : (
            <Text
              selectable
              className="mt-2 text-3xl font-bold text-ink-900"
              style={{ letterSpacing: 1.5 }}
            >
              {code}
            </Text>
          )}
          <View className="mt-4 flex-row gap-2">
            <Pressable
              onPress={onCopy}
              className="flex-1 h-12 rounded-2xl bg-silver-100 flex-row items-center justify-center active:opacity-80"
            >
              <Ionicons name="copy-outline" size={16} color="#0A0A0A" />
              <Text className="ml-2 text-sm font-bold text-ink-900">Copy</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              className="flex-[2] h-12 rounded-2xl bg-brand-600 flex-row items-center justify-center active:opacity-90"
            >
              <Ionicons name="share-outline" size={16} color="#fff" />
              <Text className="ml-2 text-sm font-bold text-white">Share with a driver</Text>
            </Pressable>
          </View>
        </Card>

        {/* Stats — read from the same referrals table */}
        <View className="mt-3 flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Joined</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">{accepted}</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Pending</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">{pending}</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Earned</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">${earned}</Text>
          </Card>
        </View>

        {/* How it works */}
        <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2 px-1">
          How it works
        </Text>
        <Card padded={false}>
          {[
            { n: 1, t: 'Share your code', b: 'Send it to drivers you know — fellow movers, ex-coworkers.' },
            { n: 2, t: 'They enter it on onboarding', b: 'During the partner onboarding flow, your code is the "referred by" field.' },
            { n: 3, t: 'They drive 5 moves', b: `Once they complete their first ${COMPLETED_MOVES_THRESHOLD} moves, both sides get $${REWARD_DOLLARS}.` },
            { n: 4, t: 'Bonus on next payout', b: 'Auto-applied to your weekly batch — no claim forms.' },
          ].map((s, i, arr) => (
            <View
              key={s.n}
              className={`flex-row items-start px-5 py-4 ${
                i < arr.length - 1 ? 'border-b border-silver-100' : ''
              }`}
            >
              <View className="h-7 w-7 rounded-full bg-brand-50 items-center justify-center">
                <Text className="text-xs font-bold text-brand-700">{s.n}</Text>
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">{s.t}</Text>
                <Text className="text-xs text-silver-500 mt-0.5 leading-5">{s.b}</Text>
              </View>
            </View>
          ))}
        </Card>

        <View className="mt-6">
          <Button
            label="Share my partner code"
            size="lg"
            fullWidth
            onPress={onShare}
            disabled={!code}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
