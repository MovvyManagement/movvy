import React, { useState } from 'react';
import { Pressable, Text, View, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  size?: 'sm' | 'md';
  /** Tap-to-explain — defaults to true. */
  explainable?: boolean;
}

export function VerifiedBadge({ size = 'sm', explainable = true }: Props) {
  const [open, setOpen] = useState(false);
  const dim = size === 'sm' ? 16 : 22;
  const pad = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  const text = size === 'sm' ? 'text-[10px]' : 'text-xs';

  const inner = (
    <View className={`flex-row items-center rounded-full bg-brand-50 ${pad}`}>
      <Ionicons name="shield-checkmark" size={dim - 4} color="#047857" />
      <Text className={`ml-1 font-bold text-brand-700 ${text}`}>Verified</Text>
    </View>
  );

  if (!explainable) return inner;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={6}>
        {inner}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
        >
          <View className="rounded-3xl bg-white p-6">
            <View className="h-16 w-16 rounded-full bg-brand-50 items-center justify-center self-center">
              <Ionicons name="shield-checkmark" size={32} color="#047857" />
            </View>
            <Text className="mt-4 text-xl font-bold text-ink-900 text-center">Verified by Movvy</Text>
            <Text className="mt-2 text-sm text-silver-500 text-center leading-5">
              Government ID confirmed · Background-checked · Insured up to $2,500 of damage protection · Has completed at least one verified move.
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              className="mt-6 h-12 rounded-2xl bg-brand-600 items-center justify-center"
            >
              <Text className="text-base font-bold text-white">Got it</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
