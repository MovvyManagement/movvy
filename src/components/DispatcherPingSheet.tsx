// =============================================================================
// DispatcherPingSheet — "you got room for this?" pre-assignment ping
//
// Used from the dispatch screen's AssignDriverModal. The dispatcher picks a
// candidate driver, taps the chat icon, and fires off a templated or custom
// message. The driver sees it in their notifications inbox (DB trigger-style
// — no new surface). Once the driver confirms back via SMS / chat / IRL,
// the dispatcher hits Assign in the same modal.
//
// Why a one-shot ping, not a full chat thread:
//   chat_threads requires a booking_id + RLS visibility via assignment, and
//   the driver isn't assigned to this booking yet — so a thread wouldn't be
//   readable on the driver side until after the assign anyway. The in_app
//   notification path side-steps that entirely.
// =============================================================================

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatcherPing } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { fmtDateShort } from '@/lib/format';

interface Props {
  visible: boolean;
  onClose: () => void;
  driverId: string;
  driverName: string;
  bookingId: string;
  shortCode: string;
  pickupCity: string;
  dropoffCity: string;
  scheduledForDate: string;
  scheduledForWindow: string | null;
}

const TEMPLATES = [
  'Got capacity for this one? Reply ASAP — assigning in 5 min.',
  'Are you nearby and free? Pickup is in your usual zone.',
  'This one needs an extra hand. You good to lead the crew?',
  'Quick check — can you finish your current move in time for this?',
];

export function DispatcherPingSheet({
  visible,
  onClose,
  driverId,
  driverName,
  bookingId,
  shortCode,
  pickupCity,
  dropoffCity,
  scheduledForDate,
  scheduledForWindow,
}: Props) {
  const ping = useDispatcherPing();
  const toast = useToast();
  const [text, setText] = useState(TEMPLATES[0]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await ping.mutateAsync({
        driver_profile_id: driverId,
        booking_id: bookingId,
        booking_short_code: shortCode,
        message: text.trim(),
      });
      haptic.success();
      toast.success(`Ping sent to ${driverName}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the message.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 30 }}>
              <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />

              <Text className="text-xl font-bold text-ink-900">
                Ping {driverName}
              </Text>
              <Text className="mt-1 text-sm text-silver-500">
                Confirm capacity before you hand off this booking.
              </Text>

              {/* Booking summary chip so the driver context is obvious */}
              <View className="mt-4 rounded-2xl bg-silver-50 p-3">
                <Text className="text-xs font-semibold text-ink-900">
                  #{shortCode} · {pickupCity} → {dropoffCity || 'in-home'}
                </Text>
                <Text className="text-[11px] text-silver-500 mt-0.5">
                  {fmtDateShort(scheduledForDate)}
                  {scheduledForWindow ? ` · ${scheduledForWindow}` : ''}
                </Text>
              </View>

              <Text className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
                Quick templates
              </Text>
              <View className="gap-2">
                {TEMPLATES.map((t) => {
                  const sel = t === text;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setText(t)}
                      className={`rounded-2xl border px-3 py-2.5 active:opacity-80 ${
                        sel
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-silver-200 bg-white'
                      }`}
                    >
                      <Text
                        className={`text-xs ${
                          sel ? 'text-brand-700 font-semibold' : 'text-ink-900'
                        }`}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
                Message
              </Text>
              <View className="rounded-2xl border border-silver-200 bg-white p-3">
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Type a quick capacity check…"
                  placeholderTextColor="#A1A1AA"
                  multiline
                  maxLength={400}
                  className="text-base text-ink-900"
                  style={{ minHeight: 80, textAlignVertical: 'top' }}
                />
              </View>
              <Text className="mt-1 text-[10px] text-silver-400 text-right">
                {text.length}/400
              </Text>

              <Pressable
                onPress={send}
                disabled={!text.trim() || ping.isPending}
                className={`mt-5 h-14 rounded-2xl items-center justify-center flex-row ${
                  text.trim() && !ping.isPending
                    ? 'bg-brand-600 active:opacity-90'
                    : 'bg-silver-300'
                }`}
              >
                {ping.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={18} color="#fff" />
                    <Text className="ml-2 text-base font-bold text-white">
                      Send ping
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
                <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
              </Pressable>

              <Text className="mt-3 text-[11px] text-silver-500 text-center">
                Lands in their notifications inbox instantly. They confirm
                back via in-app chat, SMS, or in person — then come back here
                to Assign.
              </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
