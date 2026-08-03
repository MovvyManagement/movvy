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
//   • app/(mover)/(tabs)/active.tsx  — "Chat with customer" button on active job
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
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { MovvyMark } from './MovvyMark';
import { useToast } from './Toast';
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
  /** A real phone number (E.164, e.g. "+16134163426") the header call button
   *  should dial directly. Used by the support chat, where the Movvy support
   *  line is a real number the customer can just call. When omitted (crew↔
   *  customer chat) the button explains that calls route through a Movvy proxy
   *  line, which isn't live yet. */
  callNumber?: string;
  /** Tap-to-send suggestions shown above the composer while it's empty. Saves a
   *  mover typing the same three sentences with gloves on, one-handed, in a
   *  stairwell — and keeps the customer informed with one tap. */
  quickReplies?: string[];
}

export function ChatSheet({ visible, bookingId, threadId: threadIdProp, onClose, peerName, callNumber, quickReplies }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const ensureThread = useEnsureBookingThread();
  const send = useSendChatMessage();
  const [threadId, setThreadId] = useState<string | null>(threadIdProp ?? null);
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  // Track the keyboard so the composer can drop its bottom safe-area padding
  // while the keyboard is up. Without this the home-indicator inset stacks on
  // top of the keyboard height and shoves the input under the keyboard, which
  // is what hid the text being typed.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, () => {
      setKeyboardUp(true);
      // Keep the latest message visible above the raised composer.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

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
      .catch((e: any) => {
        setThreadId(null);
        // Don't fail silently — a null thread used to make Send look tappable
        // while doing nothing at all.
        toast.error(e?.message ?? "Couldn't open this chat. Pull down to retry.");
      });
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

  const onSend = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body) return;
    // If the thread never bootstrapped (e.g. first message on a fresh booking),
    // create it now instead of silently doing nothing.
    let tid = threadId;
    if (!tid) {
      if (!bookingId) {
        toast.error("This chat isn't ready yet. Close and reopen it.");
        return;
      }
      try {
        tid = await ensureThread.mutateAsync(bookingId);
        setThreadId(tid);
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't start this chat. Try again.");
        return;
      }
    }
    if (!override) setText('');
    try {
      await send.mutateAsync({ thread_id: tid, body });
    } catch (e: any) {
      if (!override) setText(body); // restore on failure
      // Toast, not Alert — a native Alert from inside this fullScreen Modal can
      // freeze the sheet on iOS.
      toast.error(e?.message ?? 'Could not send. Try again.');
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
      // fullScreen (not pageSheet): a pageSheet is inset from the top, which
      // makes KeyboardAvoidingView's `padding` mis-measure the keyboard and
      // leave the composer hidden underneath it. Full screen keeps the input
      // pinned above the keyboard reliably.
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* edges: top only. The bottom inset is applied to the composer instead
          (and dropped while the keyboard is up) — leaving it on SafeAreaView
          double-counted against KeyboardAvoidingView's padding and pushed the
          input underneath the keyboard. */}
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        <KeyboardAvoidingView
          // Android needs an explicit behavior inside a Modal — with
          // `undefined` the OS resize never reaches this subtree, so the
          // composer stayed under the keyboard there too.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            <View className="flex-row items-center">
              <Pressable
                onPress={() => {
                  // NEVER fire a native Alert from inside this fullScreen Modal —
                  // on iOS that can leave the modal unresponsive (the "chat
                  // freezes after tapping call, and X stops working" bug). Use a
                  // toast for feedback instead, and just open the dialer when we
                  // have a real number.
                  if (callNumber) {
                    Linking.openURL(`tel:${callNumber}`).catch(() =>
                      toast.error(`Dial ${callNumber} to reach Movvy support.`),
                    );
                    return;
                  }
                  toast.info('Calls route through a Movvy line — activating soon.');
                }}
                className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center"
              >
                <Ionicons name="call" size={18} color="#fff" />
              </Pressable>
            </View>
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
              // Tapping a message or dragging the transcript closes the
              // keyboard; "handled" keeps the Send button tappable on the
              // first tap while the keyboard is still open.
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScrollBeginDrag={Keyboard.dismiss}
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

          {/* Quick replies — only while the input is empty, so they never fight
              with something being typed. Tapping sends immediately. */}
          {quickReplies && quickReplies.length > 0 && !text.trim() ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}
              style={{ maxHeight: 52 }}
            >
              {quickReplies.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => onSend(q)}
                  disabled={send.isPending}
                  className="rounded-full border border-brand-200 bg-brand-50 px-4 py-2 active:opacity-70"
                >
                  <Text className="text-xs font-semibold text-brand-700">{q}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Composer — owns the bottom safe-area inset, but drops it while the
              keyboard is up (the keyboard already clears the home indicator). */}
          <View
            className="border-t border-silver-100 px-4 pt-3 flex-row items-end gap-2 bg-white"
            style={{ paddingBottom: keyboardUp ? 12 : Math.max(insets.bottom, 12) }}
          >
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
              onPress={() => onSend()}
              disabled={!text.trim() || send.isPending}
              className={`h-11 w-11 rounded-full items-center justify-center ${
                text.trim() && !send.isPending ? 'bg-brand-600' : 'bg-silver-200'
              }`}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
