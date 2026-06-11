// =============================================================================
// PromoCodeSheet
//
// Slide-up sheet for the customer to redeem a referral / promo code from
// the Profile → Promo codes row. Backed by useApplyReferralCode (same hook
// the signup flow uses) — applies the code to the signed-in account and
// the server credits the $50 on the next completed booking.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { useApplyReferralCode } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function PromoCodeSheet({ visible, onClose }: Props) {
  const apply = useApplyReferralCode();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset every time the sheet opens so a stale failed code from the last
  // visit doesn't carry over.
  useEffect(() => {
    if (!visible) return;
    setCode('');
    setError(null);
  }, [visible]);

  const canSubmit = code.trim().length >= 4 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await apply.mutateAsync(code.trim());
      haptic.success();
      toast.success('Code applied — $50 credit on your next move');
      onClose();
    } catch (e: any) {
      haptic.error?.();
      setError(e?.message ?? "Couldn't apply that code.");
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Enter a referral code</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Got a friend's Movvy referral code? Apply it now and we'll
        automatically credit $50 toward your next move. Server promo codes
        (like MOVE50) go in at checkout.
      </Text>

      <View className="mt-5">
        <Input
          label="Code"
          placeholder="ABCD1234"
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={(t) => {
            setError(null);
            setCode(t.toUpperCase());
          }}
          error={error ?? undefined}
          leftIcon={<Ionicons name="pricetag-outline" size={18} color="#71717A" />}
        />
      </View>

      <View className="mt-5 rounded-2xl bg-silver-50 p-3 flex-row items-start">
        <Ionicons name="information-circle-outline" size={14} color="#71717A" />
        <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
          One referral per account. The $50 credit applies automatically
          to your next completed move and expires after 12 months.
        </Text>
      </View>

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canSubmit ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Apply referral</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
      </Pressable>
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            {body}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            {body}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
