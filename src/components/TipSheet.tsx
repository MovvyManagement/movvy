// =============================================================================
// TipSheet
//
// Slide-up bottom sheet for adding or changing a tip on a completed move.
// Reusable from anywhere a completed booking row is rendered (Moves history,
// rate-move banner, future receipt screen).
//
// Backend constraint: tips-submit edge fn enforces a 24h window from
// bookings.completed_at — callers SHOULD only show this sheet while the
// booking is still in that window.
// =============================================================================

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSubmitTip } from '@/lib/data';
import { haptic } from '@/lib/haptics';
import { useToast } from './Toast';

const TIP_PERCENTS = [15, 18, 20, 25] as const;

interface Props {
  visible: boolean;
  bookingId: string;
  shortCode: string;
  /** Move total in dollars, used to compute % chip amounts. */
  totalDollars: number;
  /** Current tip in cents (0 if none) — pre-fills the matching chip. */
  currentTipCents: number;
  onClose: () => void;
}

export function TipSheet({
  visible,
  bookingId,
  shortCode,
  totalDollars,
  currentTipCents,
  onClose,
}: Props) {
  // Pre-select the percentage chip that matches the existing tip, if any.
  const initialPct =
    currentTipCents > 0
      ? TIP_PERCENTS.find(
          (p) => Math.abs(Math.round(totalDollars * (p / 100)) * 100 - currentTipCents) < 50,
        ) ?? null
      : null;

  const [pickedPct, setPickedPct] = useState<number | null>(initialPct);
  const [customDollars, setCustomDollars] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitTip = useSubmitTip();
  const toast = useToast();

  const computedDollars = pickedPct
    ? Math.round(totalDollars * (pickedPct / 100))
    : customDollars
    ? Math.max(0, Math.min(500, parseInt(customDollars, 10) || 0))
    : 0;

  const hasChange = computedDollars * 100 !== currentTipCents;

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitTip.mutateAsync({
        booking_id: bookingId,
        amount_cents: computedDollars * 100,
      });
      haptic.success();
      toast.success(
        computedDollars === 0
          ? 'Tip removed'
          : `Tip ${currentTipCents > 0 ? 'updated' : 'sent'} · $${computedDollars} to your crew`,
      );
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the tip. Try again.");
    } finally {
      setSubmitting(false);
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
            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }}>
              <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />

              <Text className="text-xl font-bold text-ink-900">
                {currentTipCents > 0 ? 'Update your tip' : 'Tip your crew'}
              </Text>
              <Text className="mt-1 text-sm text-silver-500">
                Booking #{shortCode} · Move total ${totalDollars}
              </Text>

              <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
                Percentage of total
              </Text>
              <View className="flex-row gap-2">
                {TIP_PERCENTS.map((pct) => {
                  const dollars = Math.round(totalDollars * (pct / 100));
                  const selected = pickedPct === pct;
                  return (
                    <Pressable
                      key={pct}
                      onPress={() => {
                        setPickedPct(selected ? null : pct);
                        setCustomDollars('');
                      }}
                      className={`flex-1 rounded-2xl py-3 items-center border ${
                        selected ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-200'
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          selected ? 'text-white' : 'text-ink-900'
                        }`}
                      >
                        {pct}%
                      </Text>
                      <Text
                        className={`text-[10px] ${
                          selected ? 'text-white/80' : 'text-silver-500'
                        }`}
                      >
                        ${dollars}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
                Or custom amount
              </Text>
              <View className="rounded-2xl border border-silver-200 bg-white px-4 flex-row items-center">
                <Text className="text-base font-bold text-silver-500">$</Text>
                <TextInput
                  value={customDollars}
                  onChangeText={(t) => {
                    setCustomDollars(t.replace(/[^\d]/g, ''));
                    setPickedPct(null);
                  }}
                  placeholder="0"
                  placeholderTextColor="#A1A1AA"
                  keyboardType="number-pad"
                  className="flex-1 ml-2 text-base text-ink-900"
                  style={{ paddingVertical: 14 }}
                  maxLength={3}
                />
              </View>

              <Text className="mt-3 text-[11px] text-silver-500 text-center">
                100% of the tip goes to your crew. You can change or remove it
                anytime within 24 hours of the move completing.
              </Text>

              <Pressable
                onPress={submit}
                disabled={submitting || !hasChange}
                className={`mt-6 h-14 rounded-2xl items-center justify-center ${
                  submitting || !hasChange ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
                }`}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-bold text-white">
                    {computedDollars === 0
                      ? 'Remove tip'
                      : currentTipCents > 0
                      ? `Update to $${computedDollars}`
                      : `Tip $${computedDollars}`}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={onClose}
                disabled={submitting}
                className="mt-2 h-12 items-center justify-center"
              >
                <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Helper to decide whether to show the tip action — bookings <24h old. */
export function isInTipWindow(completedAt: string | null | undefined): boolean {
  if (!completedAt) return false;
  const elapsedHours = (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= 0 && elapsedHours <= 24;
}
