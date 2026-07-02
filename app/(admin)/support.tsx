// =============================================================================
// /(admin)/support — Movvy support console
//
// The "other side" of /(customer)/support. Sign in as a movvy_admin or
// movvy_support user → this screen lists every active support chat
// thread sorted by the freshest customer reply at the top. Tap a row →
// the same ChatSheet the customer uses opens, scoped to that thread.
// Anything you send goes in as is_admin=true and lands in the customer's
// support chat in real-time via Supabase Realtime.
//
// This is the minimum-viable agent console. For a production help-desk
// experience (canned replies, assignment, tagging, SLAs, internal notes)
// swap to Intercom/Crisp/Front later — but for the first hundreds of
// support conversations, this is enough.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { ChatSheet } from '@/components/ChatSheet';
import { useSupportInbox } from '@/lib/data/useSupport';

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export default function AdminSupport() {
  const { data: threads, isLoading, refetch, isRefetching } = useSupportInbox();
  const [openThread, setOpenThread] = useState<{
    id: string;
    customerName: string;
  } | null>(null);

  const unreadTotal = (threads ?? []).reduce((s, t) => s + t.unread_count, 0);

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Support"
          subtitle={
            unreadTotal > 0
              ? `${unreadTotal} unread · ${threads?.length ?? 0} active`
              : `${threads?.length ?? 0} active threads`
          }
          showBack={false}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor="#16A34A"
          />
        }
      >
        {/* Quick context — every Movvy customer who opens "Message Movvy
            Support" from the app shows up here. */}
        <Card>
          <View className="flex-row items-center">
            <View className="h-11 w-11 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="headset" size={22} color="#047857" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">
                Movvy support inbox
              </Text>
              <Text className="text-xs text-silver-500 mt-0.5 leading-5">
                Every customer's "Message Movvy support" chat lands here.
                Replies you send go back in real time.
              </Text>
            </View>
          </View>
        </Card>

        {/* List */}
        {isLoading && !threads ? (
          <View className="mt-4">
            <CardSkeleton count={4} />
          </View>
        ) : !threads || threads.length === 0 ? (
          <View className="mt-6">
            <EmptyState
              icon="chatbubbles-outline"
              title="No active support chats"
              body="When a customer taps Message Movvy support in the app, the thread shows up here."
            />
          </View>
        ) : (
          <View className="mt-4">
            {threads.map((t) => {
              const name = t.customer_name ?? 'Movvy customer';
              return (
                <View key={t.thread_id} className="mb-2">
                  <Card
                    onPress={() =>
                      setOpenThread({ id: t.thread_id, customerName: name })
                    }
                  >
                    <View className="flex-row items-start">
                      <Avatar name={name} size={44} />
                      <View className="ml-3 flex-1">
                        <View className="flex-row items-center">
                          <Text
                            className="flex-1 text-base font-bold text-ink-900"
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          {t.unread_count > 0 ? (
                            <Badge label={`${t.unread_count} new`} tone="brand" />
                          ) : null}
                        </View>
                        {t.customer_email ? (
                          <Text
                            className="text-[11px] text-silver-500"
                            numberOfLines={1}
                          >
                            {t.customer_email}
                          </Text>
                        ) : null}
                        <Text
                          className={`mt-1 text-sm leading-5 ${
                            t.unread_count > 0 ? 'text-ink-900' : 'text-silver-600'
                          }`}
                          numberOfLines={2}
                        >
                          {t.last_message_preview ?? 'No messages yet.'}
                        </Text>
                        <Text className="mt-1 text-[11px] text-silver-400">
                          {relativeTime(t.last_message_at)}
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color="#A1A1AA"
                        style={{ marginLeft: 8, marginTop: 4 }}
                      />
                    </View>
                  </Card>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* The same ChatSheet customers + crews use. When opened from this
          screen, messages send as is_admin=true (the edge function reads
          the caller's profile role). */}
      <ChatSheet
        visible={!!openThread}
        threadId={openThread?.id}
        peerName={openThread?.customerName ?? 'Customer'}
        onClose={() => setOpenThread(null)}
      />
    </SafeAreaView>
  );
}
