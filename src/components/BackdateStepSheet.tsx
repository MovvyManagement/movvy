// =============================================================================
// BackdateStepSheet — "we did this earlier than I'm tapping it"
//
// Crews forget to press buttons. Someone leaves the pickup at 4:15, gets the
// truck loaded and moving, and taps "On the way to drop-off" at 4:30. Those 15
// minutes land somewhere: on a long haul the gap between in_transit and
// unloading is SUBTRACTED from the billed clock (that stretch is charged by the
// kilometre instead), so a late tap can swing an invoice by hundreds of dollars
// in either direction — and the same timestamps decide which slice of the GPS
// trace counts as the highway drive.
//
// So let the crew say when it really happened. The phone already recorded where
// it was at 4:15; the only thing missing was someone telling us that's when the
// step happened.
//
// Deliberately NOT a datetime spinner. On a job site, with gloves on, a list of
// real clock times is faster and harder to fat-finger than a wheel — and every
// option shows the actual time, not just "15 min ago", because the crew is
// remembering a clock reading, not an interval.
//
// The server (bookings-update-status) independently bounds whatever this sends:
// never the future, never more than 12h back, never before an earlier step on
// the move. This sheet only has to be convenient; it is not the guard.
// =============================================================================

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { haptic } from '@/lib/haptics';

const STEP_MINUTES = [0, 15, 30, 45, 60, 90, 120];

function clockLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function BackdateStepSheet({
  visible,
  stepLabel,
  onCancel,
  onConfirm,
  busy,
}: {
  visible: boolean;
  /** What the crew is recording, e.g. "We've left HQ". */
  stepLabel: string;
  onCancel: () => void;
  /** ISO instant, or undefined for "now". */
  onConfirm: (occurredAt: string | undefined) => void;
  busy?: boolean;
}) {
  const [minutesAgo, setMinutesAgo] = useState(0);

  // Anchor once per open so the listed times don't drift while the crew reads
  // them — otherwise "4:15 PM" quietly becomes 4:14 mid-decision.
  const anchor = useMemo(() => Date.now(), [visible]);

  const options = useMemo(
    () =>
      STEP_MINUTES.map((m) => ({
        minutes: m,
        at: new Date(anchor - m * 60_000),
      })),
    [anchor],
  );

  const chosen = options.find((o) => o.minutes === minutesAgo) ?? options[0];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-black/40 justify-end">
        <View className="rounded-t-3xl bg-white dark:bg-night-100 px-6 pt-5 pb-8">
          <View className="items-center">
            <View className="h-1 w-10 rounded-full bg-silver-200" />
          </View>

          <Text className="mt-4 text-xl font-bold text-ink-900">When did this happen?</Text>
          <Text className="mt-1 text-sm text-silver-500 leading-5">
            Recording <Text className="font-semibold text-ink-900">{stepLabel}</Text>. If you
            forgot to tap it at the time, pick when it actually happened — your bill
            is worked out from these times.
          </Text>

          <View className="mt-5 flex-row flex-wrap gap-2">
            {options.map((o) => {
              const active = o.minutes === minutesAgo;
              return (
                <Pressable
                  key={o.minutes}
                  onPress={() => {
                    haptic.light();
                    setMinutesAgo(o.minutes);
                  }}
                  className={`rounded-2xl border px-4 py-3 ${
                    active
                      ? 'bg-brand-600 border-brand-600'
                      : 'bg-white dark:bg-night-100 border-silver-200'
                  }`}
                  accessibilityLabel={
                    o.minutes === 0 ? 'Now' : `${o.minutes} minutes ago, ${clockLabel(o.at)}`
                  }
                >
                  <Text
                    className={`text-sm font-bold ${active ? 'text-white' : 'text-ink-900'}`}
                  >
                    {clockLabel(o.at)}
                  </Text>
                  <Text
                    className={`text-[10px] mt-0.5 ${active ? 'text-white/80' : 'text-silver-500'}`}
                  >
                    {o.minutes === 0 ? 'now' : `${o.minutes} min ago`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-5 rounded-2xl bg-silver-50 border border-silver-100 p-3 flex-row">
            <Ionicons name="time-outline" size={18} color="#71717A" />
            <Text className="ml-2 flex-1 text-xs text-silver-600 leading-5">
              Recording <Text className="font-semibold text-ink-900">{stepLabel}</Text> at{' '}
              <Text className="font-semibold text-ink-900">{clockLabel(chosen.at)}</Text>
              {minutesAgo > 0 ? ' — your location from that time is used.' : '.'}
            </Text>
          </View>

          <View className="mt-5">
            <Button
              label={minutesAgo === 0 ? 'Confirm — now' : `Confirm — ${clockLabel(chosen.at)}`}
              size="lg"
              fullWidth
              loading={busy}
              onPress={() =>
                onConfirm(minutesAgo === 0 ? undefined : chosen.at.toISOString())
              }
            />
          </View>
          <Pressable onPress={onCancel} disabled={busy} className="mt-3 items-center py-2">
            <Text className="text-sm text-silver-500">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
