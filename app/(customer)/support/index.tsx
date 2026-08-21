// =============================================================================
// /(customer)/support — Customer Service
//
// This used to be a hub: a wall of tiles for insurance claims, disputes, audit
// exports and the emergency-contact editor, with live chat as one row among
// them. Every one of those paths ends with a human at Movvy reading it, so the
// menu made the customer categorise their own problem before they were allowed
// to describe it — and got it wrong often enough that ops had to re-file it.
//
// Now the screen IS the chat. Tapping Customer Service bootstraps the
// (booking-independent, permanent) support thread via `ensure_support_thread`
// and drops straight into it. Claims, disputes and audit requests all arrive
// as messages in the same thread, which lands in the web console's Support
// Inbox (/admin-management/support) where a human answers.
//
// The email/phone fallback only renders if the thread can't be opened — an
// unreachable customer is the one failure mode this screen must not have.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ChatSheet } from '@/components/ChatSheet';
import { MaxWidth } from '@/components/MaxWidth';
import { useEnsureSupportThread } from '@/lib/data';

const SUPPORT_PHONE = '+16134163426';
const SUPPORT_EMAIL = 'support@movvy.ca';

export default function SupportScreen() {
  const ensure = useEnsureSupportThread();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Open the thread on mount. `ensure_support_thread` is idempotent — it
  // returns the customer's existing thread if they've messaged before, so the
  // history is still there rather than a fresh empty window every visit.
  const open = React.useCallback(() => {
    setFailed(false);
    ensure
      .mutateAsync()
      .then((id) => setThreadId(id))
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    open();
  }, [open]);

  // Closing the chat leaves Customer Service entirely — there's nothing
  // behind it any more, and leaving the customer on a blank screen after
  // dismissing the sheet would read as a crash.
  const onClose = () => router.back();

  if (threadId) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <ChatSheet
          visible
          threadId={threadId}
          peerName="Movvy Support"
          callNumber={SUPPORT_PHONE}
          quickReplies={[
            'I need help with my move',
            "My crew hasn't arrived",
            'I need to change my booking date',
            'Something was damaged',
            'I have a billing question',
          ]}
          onClose={onClose}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Customer Service" />
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <MaxWidth>
          {!failed ? (
            <View className="items-center">
              <ActivityIndicator color="#16A34A" />
              <Text className="mt-3 text-sm text-silver-600">Opening chat…</Text>
            </View>
          ) : (
            <View>
              <View className="items-center">
                <View className="h-14 w-14 rounded-2xl bg-silver-100 items-center justify-center">
                  <Ionicons name="cloud-offline-outline" size={26} color="#71717A" />
                </View>
                <Text className="mt-3 text-base font-bold text-ink-900">
                  Couldn't open the chat
                </Text>
                <Text className="mt-1 text-center text-xs text-silver-600 leading-4">
                  Check your connection and try again — or reach us the old-fashioned way.
                </Text>
              </View>

              <Pressable
                onPress={open}
                disabled={ensure.isPending}
                className="mt-5 rounded-2xl bg-ink-900 py-4 items-center active:opacity-90"
              >
                <Text className="text-sm font-bold text-white">
                  {ensure.isPending ? 'Trying…' : 'Try again'}
                </Text>
              </Pressable>

              <Card padded={false} className="mt-4">
                <Pressable
                  onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
                  className="px-5 py-4 flex-row items-center active:opacity-70 border-b border-silver-100"
                >
                  <Ionicons name="mail-outline" size={20} color="#0A0A0A" />
                  <Text className="ml-3 flex-1 text-sm font-semibold text-ink-900">
                    {SUPPORT_EMAIL}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
                </Pressable>
                <Pressable
                  onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}
                  className="px-5 py-4 flex-row items-center active:opacity-70"
                >
                  <Ionicons name="call-outline" size={20} color="#0A0A0A" />
                  <Text className="ml-3 flex-1 text-sm font-semibold text-ink-900">
                    +1 (613) 416-3426
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#A1A1AA" />
                </Pressable>
              </Card>
            </View>
          )}
        </MaxWidth>
      </View>
    </SafeAreaView>
  );
}
