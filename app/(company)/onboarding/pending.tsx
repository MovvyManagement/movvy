// =============================================================================
// Company onboarding · share screen
//
// After the company is created, the BEFORE-INSERT trigger generates a unique
// invite_code (e.g. "CO-X7QJ4M"). The code is passed in via the URL so it
// survives a reload, and we display it big + copyable so the owner can share
// it with drivers they couldn't add up front, or re-share if an SMS was
// missed.
//
// Below the code we list every pending/sent invite so the owner can see
// who's been notified and re-send anyone who didn't get it.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/Button';
import { useCompanyInvites } from '@/lib/data';
import { haptic } from '@/lib/haptics';

export default function CompanyPending() {
  const { code, id, demo } = useLocalSearchParams<{ code?: string; id?: string; demo?: string }>();
  const inviteCode = code ?? (demo === '1' ? 'CO-DEMO12' : undefined);
  const { data: invites } = useCompanyInvites(id);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View className="flex-1 bg-white">
      <LinearGradient
        colors={['#ECFDF5', '#FFFFFF']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%' }}
      />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16, flexGrow: 1 }}
        >
          <View className="items-center pt-6">
            <View className="h-20 w-20 rounded-full bg-brand-600 items-center justify-center">
              <Ionicons name="business" size={36} color="#fff" />
            </View>
            <Text className="mt-5 text-2xl font-bold text-ink-900 text-center">
              Company submitted
            </Text>
            <Text className="mt-2 text-sm text-silver-500 text-center leading-5">
              We'll verify in 1–3 business days. In the meantime, share your
              code with your drivers so they can join.
            </Text>
          </View>

          {/* ─── Invite code card ────────────────────────────────────────── */}
          {inviteCode ? (
            <View className="mt-7 rounded-3xl bg-white border border-brand-100 p-5 shadow-sm">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Your company invite code
              </Text>
              <Text
                selectable
                className="mt-2 text-4xl font-bold text-ink-900"
                style={{ letterSpacing: 2 }}
              >
                {inviteCode}
              </Text>
              <Text className="mt-2 text-xs text-silver-500 leading-5">
                Every driver you add must enter this code (plus the email or
                phone you registered for them) to join. No one outside your
                roster can claim to be your driver.
              </Text>
              <View className="mt-4 flex-row gap-2">
                <Pressable
                  onPress={copy}
                  className="flex-1 h-12 flex-row items-center justify-center rounded-2xl bg-brand-600 active:opacity-90"
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text className="ml-2 text-sm font-bold text-white">
                    {copied ? 'Copied!' : 'Copy code'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* ─── Pending invite list ─────────────────────────────────────── */}
          {invites && invites.length > 0 ? (
            <View className="mt-6">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Invites sent
              </Text>
              {invites.map((inv) => (
                <View
                  key={inv.id}
                  className="rounded-2xl border border-silver-200 bg-white p-3 mb-2 flex-row items-center"
                >
                  <View
                    className={`h-9 w-9 rounded-full items-center justify-center ${
                      inv.status === 'accepted' ? 'bg-brand-600' : 'bg-silver-100'
                    }`}
                  >
                    <Ionicons
                      name={
                        inv.status === 'accepted'
                          ? 'checkmark'
                          : inv.last_channel === 'sms'
                          ? 'chatbubble-outline'
                          : 'mail-outline'
                      }
                      size={16}
                      color={inv.status === 'accepted' ? '#fff' : '#71717A'}
                    />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-bold text-ink-900">
                      {inv.full_name ?? inv.email ?? inv.phone}
                    </Text>
                    <Text className="text-xs text-silver-500">
                      {inv.phone ?? inv.email}
                      {' · '}
                      {inv.status === 'accepted'
                        ? 'Joined'
                        : inv.status === 'sent'
                        ? `${inv.last_channel?.toUpperCase() ?? 'SENT'} delivered`
                        : 'Pending'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row">
            <Ionicons name="shield-checkmark-outline" size={18} color="#71717A" />
            <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
              Already onboarded? Drivers on your roster can sign in any time
              from the welcome screen using the code above and the email or
              phone you registered for them.
            </Text>
          </View>
        </ScrollView>

        <View className="px-6 pb-2 pt-2 border-t border-silver-100 bg-white">
          <Button
            label="Go to dashboard"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(company)/dashboard')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}
