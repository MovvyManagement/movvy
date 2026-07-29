// =============================================================================
// /(customer)/support/sos — Emergency button
//
// Two-second hold-to-confirm so a pocket-tap doesn't blast every admin's
// phone in the middle of the night. While holding, we also grab GPS so
// admins land on the most-recent coordinates.
//
// What happens when the customer commits:
//   • support-sos edge fn fans out push + in_app to admins / dispatcher /
//     driver, SMS to emergency contact, RCMP tip email (when configured),
//     and creates a 'sos' dispute row
//   • We open the support thread so the customer can keep typing the rest
//     of the story to a live admin
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Animated, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ChatSheet } from '@/components/ChatSheet';
import { useActiveBooking, useProfile, useSos } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

const HOLD_MS = 2000;

export default function SosScreen() {
  const { data: active } = useActiveBooking();
  const { data: profile } = useProfile();
  const sos = useSos();
  const toast = useToast();

  const [message, setMessage] = useState('');
  const [holding, setHolding] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);

  // GPS — fire when the screen mounts so we have the most recent fix even
  // if the customer never pushes the button (e.g. their hands are full).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Location = await import('expo-location').catch(() => null);
        if (!Location) return;
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // We don't beg for it here — the live tracker has already asked.
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!cancelled) {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {/* silent */}
    })();
    return () => { cancelled = true; };
  }, []);

  // Press-and-hold animation: a ring fills around the button while held;
  // releasing early aborts. Native driver keeps the ring buttery even
  // when JS thread is busy with the SOS request.
  const progress = useRef(new Animated.Value(0)).current;
  const startHold = () => {
    if (!active) return;
    haptic.warning();
    setHolding(true);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        // Held the full duration — trigger.
        triggerSos();
      }
      setHolding(false);
    });
  };
  const cancelHold = () => {
    progress.stopAnimation();
    progress.setValue(0);
    setHolding(false);
  };

  const triggerSos = async () => {
    if (!active) return;
    haptic.error();
    try {
      const res = await sos.mutateAsync({
        booking_id: active.id,
        message: message.trim() || undefined,
        lat: coords?.lat,
        lng: coords?.lng,
      });
      if (res.support_thread_id) {
        setChatThreadId(res.support_thread_id);
      }
      toast.success(
        `SOS sent · ${res.recipients} responder${res.recipients === 1 ? '' : 's'} alerted`,
      );
    } catch (e: any) {
      Alert.alert(
        "Couldn't send SOS",
        (e?.message ?? 'Try again.') + '\n\nIf this is life-threatening, call 911 now.',
        [
          { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
          { text: 'Retry', onPress: triggerSos },
          { text: 'Close', style: 'cancel' },
        ],
      );
    }
  };

  // Visual width % for the progress ring overlay on the SOS button.
  const ringWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Emergency" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        {/* Quick-out: 911 + dispatch numbers up top, always tappable. */}
        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={() => Linking.openURL('tel:911')}
            className="flex-1 h-14 rounded-2xl bg-danger items-center justify-center flex-row active:opacity-90"
          >
            <Ionicons name="call" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Call 911</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL('tel:+16134163426')}
            className="flex-1 h-14 rounded-2xl bg-ink-900 items-center justify-center flex-row active:opacity-90"
          >
            <Ionicons name="headset" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Movvy line</Text>
          </Pressable>
        </View>

        {!active ? (
          <View className="rounded-3xl bg-silver-50 border border-silver-200 p-5 items-center">
            <Ionicons name="information-circle-outline" size={36} color="#71717A" />
            <Text className="mt-3 text-base font-bold text-ink-900">
              SOS is only for active moves
            </Text>
            <Text className="mt-1 text-sm text-silver-500 text-center leading-5">
              You don't have a move in progress right now. For non-emergency
              issues, message Movvy support from the Help & Support hub.
            </Text>
          </View>
        ) : (
          <>
            {/* Context card — confirms exactly what booking is being SOS-ed */}
            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Booking
              </Text>
              <Text className="mt-1 text-base font-bold text-ink-900">#{active.short_code}</Text>
              <Text className="mt-1 text-xs text-silver-500">
                {active.pickup_city} → {active.dropoff_city ?? 'in-home'}
              </Text>
              {coords ? (
                <Text className="mt-2 text-[11px] text-silver-400">
                  Last known location: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                </Text>
              ) : (
                <Text className="mt-2 text-[11px] text-amber-700">
                  Couldn't grab your GPS — admins won't see your live coords.
                </Text>
              )}
            </Card>

            {/* Optional context message */}
            <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              What's going on? (optional)
            </Text>
            <View className="rounded-2xl border border-silver-200 bg-white p-3">
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="A short note helps admins prioritise. E.g. 'crew won't leave my house'."
                placeholderTextColor="#A1A1AA"
                multiline
                maxLength={500}
                className="text-base text-ink-900"
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </View>

            {/* Hold-to-trigger button */}
            <View className="mt-7 items-center">
              <Pressable
                onPressIn={startHold}
                onPressOut={cancelHold}
                disabled={sos.isPending}
                className="h-48 w-48 rounded-full bg-danger items-center justify-center"
                style={{ overflow: 'hidden' }}
              >
                {/* Filling ring overlay — visible feedback for the hold */}
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    inset: 0 as any,
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    width: ringWidth,
                    height: '100%',
                  }}
                />
                <Ionicons name="warning" size={48} color="#fff" />
                <Text className="mt-2 text-lg font-bold text-white">
                  {sos.isPending ? 'Sending…' : holding ? 'Keep holding' : 'Hold for SOS'}
                </Text>
              </Pressable>
              <Text className="mt-3 text-xs text-silver-500 text-center px-4 leading-4">
                Hold for {Math.round(HOLD_MS / 1000)} seconds to send. Releasing
                early cancels — protects you from a pocket-tap.
              </Text>
            </View>

            {/* Emergency contact reminder */}
            {!profile?.emergency_contact_phone ? (
              <Pressable
                onPress={() => router.push('/(customer)/(tabs)/profile')}
                className="mt-6 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row items-center active:opacity-80"
              >
                <Ionicons name="alert-circle" size={18} color="#B45309" />
                <View className="ml-2 flex-1">
                  <Text className="text-sm font-bold text-amber-900">
                    No emergency contact on file
                  </Text>
                  <Text className="text-[11px] text-amber-800 mt-0.5 leading-4">
                    Add one in your profile so we can SMS them instantly if
                    you hit SOS.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#B45309" />
              </Pressable>
            ) : (
              <View className="mt-6 rounded-2xl bg-brand-50 border border-brand-100 p-3 flex-row items-center">
                <Ionicons name="shield-checkmark" size={18} color="#047857" />
                <Text className="ml-2 flex-1 text-[11px] text-ink-700 leading-4">
                  Emergency contact on file: {profile.emergency_contact_name ?? 'set'}.
                  They'll be SMS'd instantly.
                </Text>
              </View>
            )}
          </>
        )}

        <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row items-start">
          <Ionicons name="lock-closed-outline" size={16} color="#71717A" />
          <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
            Every SOS is audited. Misuse may result in account suspension.
            For life-threatening emergencies, dial 911 first — Movvy support
            cannot replace emergency services.
          </Text>
        </View>
      </ScrollView>

      <ChatSheet
        visible={!!chatThreadId}
        threadId={chatThreadId}
        peerName="Movvy support"
        callNumber="+16134163426"
        onClose={() => {
          setChatThreadId(null);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
