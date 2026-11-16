// =============================================================================
// LocationDisclosureSheet — the crew's notice before the location prompts.
//
// Mounted once in the crew layout. It stays invisible until startLiveLocation
// is about to trigger a system location prompt, then explains, in plain words,
// what Movvy collects, why, who sees it, and that it continues while the app is
// closed. See src/lib/locationDisclosure.ts for why this exists.
//
// Platform difference, on purpose:
//   • Android shows "Continue" and "Not now". Google wants a real choice before
//     the request; "Not now" skips the system prompts entirely.
//   • iOS shows "Continue" only. Apple rejects pre-permission screens that let
//     people skip the system prompt, because the system prompt is where the
//     choice is made.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { registerLocationDisclosure } from '@/lib/locationDisclosure';
import { useThemedColors } from '@/lib/theme';
import { haptic } from '@/lib/haptics';

const IS_IOS = Platform.OS === 'ios';

// The system prompt can't appear while this modal is still animating away, so
// the answer is handed back only after the dismissal finishes.
const DISMISS_MS = 400;

export function LocationDisclosureSheet() {
  const palette = useThemedColors();
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    registerLocationDisclosure(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setOpen(true);
        }),
    );
    return () => {
      registerLocationDisclosure(null);
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  const answer = (ok: boolean) => {
    if (ok) haptic.medium();
    setOpen(false);
    const resolve = resolver.current;
    resolver.current = null;
    setTimeout(() => resolve?.(ok), DISMISS_MS);
  };

  const points: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    {
      icon: 'navigate-outline',
      text: 'Your customer sees your truck on a map and how far away you are.',
    },
    {
      icon: 'time-outline',
      text: "It starts when you tap We've left HQ and stops automatically when the move is finished.",
    },
    {
      icon: 'speedometer-outline',
      text: 'On long-distance moves, the route you drive sets the distance charge on the bill.',
    },
    {
      icon: 'lock-closed-outline',
      text: 'Only the customer and Movvy see it. It is never shared outside the move or used for ads.',
    },
  ];

  const body = (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
      {IS_IOS ? null : (
        <View
          style={{ backgroundColor: palette.border }}
          className="self-center h-1.5 w-12 rounded-full mb-4"
        />
      )}

      <View
        style={{ backgroundColor: palette.surfaceMuted }}
        className="h-14 w-14 rounded-2xl items-center justify-center"
      >
        <Ionicons name="location" size={28} color={palette.brand} />
      </View>

      <Text style={{ color: palette.text }} className="mt-4 text-2xl font-bold">
        Share your location during moves
      </Text>
      <Text style={{ color: palette.textMuted }} className="mt-2 text-base leading-6">
        Movvy collects your location during an active move, including when the app is
        closed or not in use, so the customer can follow the move live.
      </Text>

      <View className="mt-5 gap-4">
        {points.map((p) => (
          <View key={p.text} className="flex-row">
            <Ionicons name={p.icon} size={20} color={palette.brand} style={{ marginTop: 1 }} />
            <Text style={{ color: palette.text }} className="ml-3 flex-1 text-sm leading-5">
              {p.text}
            </Text>
          </View>
        ))}
      </View>

      <Text style={{ color: palette.textMuted }} className="mt-5 text-sm leading-5">
        {IS_IOS
          ? 'On the next screens, allow location, then choose Change to Always Allow so tracking keeps working when your phone is locked.'
          : 'On the next screens, allow location, then choose Allow all the time so tracking keeps working when your phone is locked.'}
      </Text>

      <Pressable
        onPress={() => answer(true)}
        accessibilityRole="button"
        style={{ backgroundColor: palette.brand }}
        className="mt-6 h-14 rounded-2xl items-center justify-center active:opacity-90"
      >
        <Text className="text-base font-bold text-white">Continue</Text>
      </Pressable>

      {IS_IOS ? null : (
        <Pressable
          onPress={() => answer(false)}
          accessibilityRole="button"
          className="mt-2 h-12 items-center justify-center"
        >
          <Text style={{ color: palette.textMuted }} className="text-sm font-semibold">
            Not now
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }} edges={['bottom']}>
          {body}
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => answer(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <View
          style={{ backgroundColor: palette.surface, maxHeight: '92%' }}
          className="rounded-t-3xl"
        >
          <SafeAreaView edges={['bottom']}>{body}</SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
