import React from 'react';
import { View, Text, ScrollView, Pressable, Share, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useMyReferralCode, useMyReferralStats } from '@/lib/data';
import { fmtCurrency } from '@/lib/format';
import { haptic } from '@/lib/haptics';

export default function Referrals() {
  const { data: code, isLoading } = useMyReferralCode();
  const { data: stats } = useMyReferralStats();

  const onShare = async () => {
    if (!code) return;
    haptic.success();
    try {
      await Share.share({
        message: `Try Movvy — Alberta's easiest moving service. Use my code ${code} and we'll both get $50 off our next move. https://movvy.ca/r/${code}`,
        title: 'Try Movvy',
      });
    } catch {
      // user cancelled
    }
  };

  const onCopy = async () => {
    if (!code) return;
    haptic.light();
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(code);
      Alert.alert('Copied', `Your referral code "${code}" is copied. Paste it anywhere.`);
    } catch {
      Alert.alert('Your code', code);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top', 'bottom']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Invite Friends" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Hero */}
        <View className="rounded-3xl overflow-hidden mb-4">
          <LinearGradient
            colors={['#047857', '#16A34A']}
            style={{ padding: 24 }}
          >
            <Text className="text-white/80 text-xs font-bold uppercase tracking-wider">
              Your code
            </Text>
            <Text className="text-white text-4xl font-bold mt-2 tracking-widest">
              {isLoading ? '· · · · · · ·' : (code ?? '—')}
            </Text>
            <Text className="text-white/90 text-sm mt-3 leading-5">
              Friends who book with this code get <Text className="font-bold">$50 off</Text> their first move —{' '}
              and so do you, applied automatically to your next booking.
            </Text>
            <View className="mt-5 flex-row gap-2">
              <Pressable
                onPress={onShare}
                className="flex-1 h-12 rounded-2xl bg-white items-center justify-center flex-row active:opacity-80"
              >
                <Ionicons name="share-outline" size={18} color="#047857" />
                <Text className="ml-2 text-sm font-bold text-brand-700">Share code</Text>
              </Pressable>
              <Pressable
                onPress={onCopy}
                className="h-12 px-4 rounded-2xl bg-white/15 items-center justify-center flex-row active:opacity-80"
              >
                <Ionicons name="copy-outline" size={18} color="#fff" />
                <Text className="ml-2 text-sm font-bold text-white">Copy</Text>
              </Pressable>
            </View>
          </LinearGradient>
        </View>

        {/* Stats */}
        <View className="flex-row gap-3 mb-4">
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Friends invited</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">{stats?.invited ?? 0}</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-xs text-silver-500 uppercase font-semibold">Credits earned</Text>
            <Text className="text-2xl font-bold text-ink-900 mt-1">
              {fmtCurrency((stats?.creditsEarnedCents ?? 0) / 100)}
            </Text>
          </Card>
        </View>

        <Card>
          <Text className="text-base font-bold text-ink-900">How it works</Text>
          <View className="mt-3 gap-3">
            {[
              { icon: 'share-outline' as const, label: 'Share your code with anyone moving soon.' },
              { icon: 'card-outline' as const, label: 'They enter it at checkout and save $50 on their first move.' },
              { icon: 'gift-outline' as const, label: 'The moment they book their first move, you get $50 credit on your next booking — automatically.' },
            ].map((s, i) => (
              <View key={s.label} className="flex-row items-start">
                <View className="h-8 w-8 rounded-full bg-brand-50 items-center justify-center">
                  <Ionicons name={s.icon} size={16} color="#047857" />
                </View>
                <Text className="ml-3 flex-1 text-sm text-ink-700 leading-5">{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card className="mt-3">
          <Text className="text-xs text-silver-500 leading-5">
            Credits are non-cashable and expire 12 months after issue. One credit per move. No limit on how many friends you invite.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
