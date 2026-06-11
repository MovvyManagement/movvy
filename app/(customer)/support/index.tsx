// =============================================================================
// /(customer)/support — Help & Support hub
//
// Single entry point for every "I need a human" path:
//   • Open chat with Movvy support (kind='support' thread, lives forever)
//   • Trigger SOS mid-move
//   • File an insurance claim against a completed move
//   • File a damage / theft / dispute against a move
//   • Export the audit trail of a move as a tamper-evident PDF
//
// Reached from the customer profile's Help row + a floating SOS shortcut
// on the live tracker.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ChatSheet } from '@/components/ChatSheet';
import { MaxWidth } from '@/components/MaxWidth';
import { EmergencyContactSheet } from '@/components/EmergencyContactSheet';
import { useEnsureSupportThread, useActiveBooking, useProfile } from '@/lib/data';
import { useToast } from '@/components/Toast';

type Tile = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tone: 'sos' | 'brand' | 'silver';
  onPress: () => void;
};

export default function SupportHub() {
  const ensure = useEnsureSupportThread();
  const toast = useToast();
  const { data: active } = useActiveBooking();
  const { data: profile } = useProfile();
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  // Emergency contact lives here now (instead of as its own Profile row) so
  // every safety control sits behind the single Customer Service entry.
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const openSupportChat = async () => {
    try {
      const id = await ensure.mutateAsync();
      setChatThreadId(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open support chat.");
    }
  };

  const tiles: Tile[] = [
    {
      icon: 'warning',
      title: 'Trigger SOS',
      body: active
        ? `Alert support + dispatch instantly for booking #${active.short_code}.`
        : 'Only available when a move is in progress.',
      tone: 'sos',
      onPress: () => {
        if (!active) {
          toast.info('SOS is only available during an in-flight move.');
          return;
        }
        router.push('/(customer)/support/sos');
      },
    },
    {
      icon: 'shield-checkmark',
      title: 'File an insurance claim',
      body: 'Up to $5,000 coverage on every completed move — submit with photos.',
      tone: 'brand',
      onPress: () => router.push('/(customer)/support/claim'),
    },
    {
      icon: 'document-text',
      title: 'Open a dispute',
      body: 'Damage, theft, poor service — formal evidence track, reviewed by humans.',
      tone: 'silver',
      onPress: () => router.push('/(customer)/support/dispute'),
    },
    {
      icon: 'archive',
      title: 'Export move audit log',
      body: "Tamper-evident PDF of every event on a move's record. Useful for legal disputes.",
      tone: 'silver',
      onPress: () => router.push('/(customer)/support/audit'),
    },
    {
      icon: 'person-add',
      title: profile?.emergency_contact_phone
        ? 'Edit emergency contact'
        : 'Set an emergency contact',
      body: profile?.emergency_contact_phone
        ? `Texted instantly if you hit SOS during a move.`
        : 'Pick someone we SMS the moment you trigger SOS — family, partner, close friend.',
      tone: 'silver',
      onPress: () => setEmergencyOpen(true),
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Customer Service" />
      </View>

      {/* MaxWidth keeps the hub a comfortable 560 dp on iPad / web — same
          width customers see on iPhone, just centred in the larger window. */}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <MaxWidth>
        {/* Primary action — open a thread with Movvy support */}
        <Pressable
          onPress={openSupportChat}
          disabled={ensure.isPending}
          className="rounded-3xl bg-ink-900 p-5 flex-row items-center active:opacity-90"
        >
          <View className="h-12 w-12 rounded-2xl bg-brand-600 items-center justify-center">
            <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-base font-bold text-white">
              {ensure.isPending ? 'Opening chat…' : 'Message Movvy support'}
            </Text>
            <Text className="text-xs text-white/70 mt-0.5 leading-4">
              Real humans · usually replies in under 10 minutes
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </Pressable>

        {/* Action tiles */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          When something goes wrong
        </Text>
        {tiles.map((t) => (
          <Pressable
            key={t.title}
            onPress={t.onPress}
            className={`mb-3 rounded-3xl p-4 flex-row items-center active:opacity-80 ${
              t.tone === 'sos'
                ? 'bg-red-50 border-2 border-red-100'
                : t.tone === 'brand'
                ? 'bg-brand-50 border border-brand-100'
                : 'bg-white border border-silver-200'
            }`}
          >
            <View
              className={`h-12 w-12 rounded-2xl items-center justify-center ${
                t.tone === 'sos'
                  ? 'bg-danger'
                  : t.tone === 'brand'
                  ? 'bg-brand-600'
                  : 'bg-silver-100'
              }`}
            >
              <Ionicons
                name={t.icon}
                size={22}
                color={t.tone === 'silver' ? '#0A0A0A' : '#fff'}
              />
            </View>
            <View className="ml-3 flex-1">
              <Text
                className={`text-sm font-bold ${
                  t.tone === 'sos' ? 'text-danger' : 'text-ink-900'
                }`}
              >
                {t.title}
              </Text>
              <Text className="mt-0.5 text-[11px] text-silver-600 leading-4">{t.body}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={t.tone === 'sos' ? '#B91C1C' : '#A1A1AA'}
            />
          </Pressable>
        ))}

        {/* Fallback contacts — keep the lights on even if the in-app paths
            are unreachable. */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Other ways to reach us
        </Text>
        <Card padded={false}>
          <Pressable
            onPress={() => Linking.openURL('mailto:support@movvy.ca')}
            className="px-5 py-4 flex-row items-center active:opacity-70 border-b border-silver-100"
          >
            <Ionicons name="mail-outline" size={20} color="#0A0A0A" />
            <Text className="ml-3 flex-1 text-sm font-semibold text-ink-900">support@movvy.ca</Text>
            <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL('tel:+18335006689')}
            className="px-5 py-4 flex-row items-center active:opacity-70"
          >
            <Ionicons name="call-outline" size={20} color="#0A0A0A" />
            <Text className="ml-3 flex-1 text-sm font-semibold text-ink-900">1-833-500-MOVE</Text>
            <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
          </Pressable>
        </Card>

        <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row items-start">
          <Ionicons name="information-circle-outline" size={16} color="#71717A" />
          <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
            Everything you do here is logged. SOS notifies admin + dispatch
            + your emergency contact instantly. Claims and disputes create a
            formal record with photo evidence, reviewed by a human, never
            an automated bot.
          </Text>
        </View>
        </MaxWidth>
      </ScrollView>

      {/* Open in a slide-up ChatSheet — kept in line with the rest of the
          customer chat surface so we don't introduce a new modal pattern.
          For support we pass the thread id directly (the support thread is
          NOT booking-scoped). */}
      <ChatSheet
        visible={!!chatThreadId}
        threadId={chatThreadId}
        peerName="Movvy support"
        onClose={() => setChatThreadId(null)}
      />

      {/* Emergency contact editor — moved here from Profile so every safety
          path lives behind the single Customer Service entry. */}
      <EmergencyContactSheet
        visible={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
      />
    </SafeAreaView>
  );
}
