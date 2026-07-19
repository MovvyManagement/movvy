// =============================================================================
// Two-man crew onboarding · share screen
//
// Mirrors (company)/onboarding/pending.tsx — shows the auto-generated team
// invite code (e.g. "TM-K4P2QH") so the driver can pass it to their mover
// (and any future replacement movers) to join the team.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/Button';
import { useTeamInvites } from '@/lib/data';
import { haptic } from '@/lib/haptics';

export default function Pending() {
  const { code, id, demo } = useLocalSearchParams<{ code?: string; id?: string; demo?: string }>();
  const inviteCode = code ?? (demo === '1' ? 'TM-DEMO34' : undefined);
  const { data: invites } = useTeamInvites(id);
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
              <Ionicons name="checkmark" size={42} color="#fff" />
            </View>
            <Text className="mt-5 text-2xl font-bold text-ink-900 text-center">
              You're in review
            </Text>
            <Text className="mt-2 text-sm text-silver-500 text-center leading-5">
              Movvy is verifying your details — typically 24–48 hours. In the
              meantime, your mover just got a text/email with your team code.
            </Text>
          </View>

          {/* ─── Invite code card ────────────────────────────────────────── */}
          {inviteCode ? (
            <View className="mt-7 rounded-3xl bg-white border border-brand-100 p-5 shadow-sm">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Your team invite code
              </Text>
              <Text
                selectable
                className="mt-2 text-4xl font-bold text-ink-900"
                style={{ letterSpacing: 2 }}
              >
                {inviteCode}
              </Text>
              <Text className="mt-2 text-xs text-silver-500 leading-5">
                Your mover (and any future replacement) needs this code plus
                the email or phone you registered them with to join the team.
              </Text>
              <Pressable
                onPress={copy}
                className="mt-4 h-12 flex-row items-center justify-center rounded-2xl bg-brand-600 active:opacity-90"
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

          <View className="mt-6 rounded-3xl border border-silver-200 bg-white p-5">
            <View className="flex-row items-start gap-3">
              <Ionicons name="time-outline" size={20} color="#047857" />
              <View className="flex-1">
                <Text className="text-sm font-bold text-ink-900">What's next</Text>
                <Text className="text-xs text-silver-500 mt-1 leading-5">
                  · Background check (24h){'\n'}
                  · Document verification{'\n'}
                  · Welcome call from Movvy
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View className="px-6 pb-2 pt-2 border-t border-silver-100 bg-white">
          <Button
            label="See the driver app"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(mover)/(tabs)/dashboard')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}
