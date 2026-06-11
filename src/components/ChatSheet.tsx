// =============================================================================
// ChatSheet
//
// Slide-up modal that lets either party (customer or crew) message the other.
// Replaces the old /(customer)/chat/[id] route screen — chat is no longer a
// navigable route, which means it can never accidentally appear in the bottom
// tab bar. Embed this component anywhere chat needs to be reachable and
// toggle `visible` via local state.
//
// Used from:
//   • app/(customer)/live.tsx — "Chat with crew" button on the live tracker
//   • app/(mover)/active.tsx  — "Chat with customer" button on active job
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { MovvyMark } from './MovvyMark';
import { fmtTime } from '@/lib/format';
import {
  useEnsureBookingThread,
  useThreadMessages,
  useSendChatMessage,
} from '@/lib/data';
import { useAuth, supabaseConfigured } from '@/lib/supabase';
import { mockMessages } from '@/data/mockMessages';
import { mockFallbacksEnabled } from '@/lib/mocks';

interface Props {
  visible: boolean;
  /** Pass either a booking_id (we'll bootstrap the booking-scoped thread)
   *  OR a threadId directly (used by the support hub which has its own
   *  bootstrap RPC `ensure_support_thread`). One or the other — not both. */
  bookingId?: string;
  threadId?: string | null;
  onClose: () => void;
  /** Display name shown in the header (e.g. driver name or customer name). */
  peerName?: string;
}

export function ChatSheet({ visible, bookingId, threadId: threadIdProp, onClose, peerName }: Props) {
  const { user } = useAuth();
  const ensureThread = useEnsureBookingThread();
  const send = useSendChatMessage();
  const [threadId, setThreadId] = useState<string | null>(threadIdProp ?? null);
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // If the caller handed us a threadId directly, use it. Otherwise bootstrap
  // the booking-scoped thread on open. Only one path runs per render.
  useEffect(() => {
    if (!visible || !supabaseConfigured) return;
    if (threadIdProp) {
      setThreadId(threadIdProp);
      return;
    }
    if (!bookingId) return;
    ensureThread
      .mutateAsync(bookingId)
      .then(setThreadId)
      .catch(() => setThreadId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, bookingId, threadIdProp]);

  const { messages, loading } = useThreadMessages(threadId ?? undefined);

  // Auto-scroll to bottom when new messages arrive or the sheet opens.
  useEffect(() => {
    if (!visible) return;
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length, visible]);

  const onSend = async () => {
    if (!text.trim() || !threadId) return;
    const body = text.trim();
    setText('');
    try {
      await send.mutateAsync({ thread_id: threadId, body });
    } catch (e: any) {
      setText(body); // restore on failure
      Alert.alert('Could not send', e?.message ?? 'Try again.');
    }
  };

  // Live thread vs mock fallback for demo mode.
  const showLive = supabaseConfigured && !!threadId;
  // In production we hide mockMessages — an empty thread is shown instead.
  // Dev users can opt in via EXPO_PUBLIC_USE_MOCK_FALLBACKS=1 for design work.
  const renderMessages: any[] = showLive
    ? messages
    : mockFallbacksEnabled
    ? (mockMessages as any[])
    : [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          {/* Header */}
          <View className="px-5 py-3 flex-row items-center justify-between border-b border-silver-100">
            <Pressable onPress={onClose} hitSlop={10} className="w-10 h-10 items-center justify-center">
              <Ionicons name="close" size={26} color="#0A0A0A" />
            </Pressable>
            <View className="flex-1 items-center">
              <Text className="text-base font-bold text-ink-900">
                {peerName ? `Chat · ${peerName}` : 'Movvy chat'}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <MovvyMark size="sm" />
                <Text className="ml-1.5 text-[11px] text-silver-500">
                  Via Movvy line · numbers private
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Calling via Movvy line',
                  "We'll connect you through a Movvy number so your real phone stays private. (Activates once Twilio is wired.)"
                )
              }
              className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center"
            >
              <Ionicons name="call" size={18} color="#fff" />
            </Pressable>
          </View>

          {/* Messages */}
          {showLive && loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#16A34A" />
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ padding: 20, paddingBottom: 30 }}
            >
              {renderMessages.map((m) => {
                if (m.is_admin || m.from === 'admin') {
                  return (
                    <View key={m.id} className="my-3 self-center max-w-[85%]">
                      <View className="rounded-full bg-silver-100 px-4 py-2">
                        <Text className="text-xs text-silver-600">{m.body}</Text>
                      </View>
                    </View>
                  );
                }
                const me = showLive ? m.sender_profile_id === user?.id : m.from === 'me';
                return (
                  <View
                    key={m.id}
                    className={`mb-3 max-w-[80%] ${me ? 'self-end' : 'self-start'}`}
                  >
                    {!me ? (
                      <View className="flex-row items-end">
                        <Avatar name={peerName ?? 'Crew'} size={28} />
                        <View className="ml-2 rounded-3xl rounded-bl-md bg-silver-100 px-4 py-3">
                          <Text className="text-sm text-ink-900">{m.body}</Text>
                        </View>
                      </View>
                    ) : (
                      <View className="rounded-3xl rounded-br-md bg-brand-600 px-4 py-3">
                        <Text className="text-sm text-white">{m.body}</Text>
                      </View>
                    )}
                    <Text
                      className={`text-[10px] mt-1 text-silver-400 ${me ? 'text-right' : 'ml-9'}`}
                    >
                      {fmtTime(m.created_at ?? m.at)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Composer */}
          <View className="border-t border-silver-100 px-4 py-3 flex-row items-end gap-2">
            <View className="flex-1 flex-row items-end rounded-3xl border border-silver-200 bg-white px-4">
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Message"
                placeholderTextColor="#A1A1AA"
                multiline
                className="flex-1 text-base text-ink-900"
                style={{ minHeight: 40, maxHeight: 100, paddingVertical: 10 }}
              />
            </View>
            <Pressable
              onPress={onSend}
              disabled={!text.trim() || send.isPending}
              className={`h-11 w-11 rounded-full items-center justify-center ${
                text.trim() && !send.isPending ? 'bg-brand-600' : 'bg-silver-200'
              }`}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
