// =============================================================================
// DeleteAccountSheet
//
// Cross-platform replacement for the old Alert.prompt confirmation on the
// customer profile. Alert.prompt is iOS-ONLY — on Android the dialog never
// appeared, which made account deletion impossible there (and Google Play
// requires working in-app deletion for any app with account creation).
//
// Flow: the customer types the email or phone on their account, the
// account-delete edge fn verifies it matches (server-side), strips PII, and
// signs them out. Mirrors the EditNameSheet modal pattern — Modal pageSheet
// on iOS, slide-up on Android.
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { useDeleteAccount } from '@/lib/data';
import { logout } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function DeleteAccountSheet({ visible, onClose }: Props) {
  const deleteAcct = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh state every open — never pre-fill a destructive confirmation.
  useEffect(() => {
    if (!visible) return;
    setTyped('');
    setError(null);
  }, [visible]);

  // Server enforces the real match (min 3 chars in its schema); the button
  // just needs enough input to be a plausible attempt.
  const canDelete = typed.trim().length >= 3 && !busy;

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAcct.mutateAsync({ confirm_email_or_phone: typed.trim() });
      haptic.success();
      onClose();
      // Alert.alert (unlike .prompt) IS cross-platform — it overlays the
      // welcome screen after the redirect below.
      Alert.alert('Account deleted', "You've been signed out. We're sorry to see you go.");
      await logout();
      router.replace('/');
    } catch (e: any) {
      haptic.error();
      // Typical server message: "Confirmation does not match your email or
      // phone" — surface it right on the field so the fix is obvious.
      setError(e?.message ?? "Couldn't delete your account. Try again.");
    } finally {
      setBusy(false);
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

      <Text className="text-2xl font-bold text-ink-900">Delete your Movvy account?</Text>
      <Text className="mt-1 text-sm text-silver-500 leading-5">
        Your account, saved addresses, and devices will be removed. Past
        bookings and receipts are kept for accounting.{' '}
        <Text className="font-bold text-ink-900">This cannot be undone.</Text>
      </Text>

      <View className="mt-5">
        <Input
          label="Confirm it's you"
          placeholder="Email or phone on your account"
          autoCapitalize="none"
          autoCorrect={false}
          value={typed}
          onChangeText={(t) => {
            setTyped(t);
            if (error) setError(null);
          }}
          error={error ?? undefined}
          hint={error ? undefined : 'Type the email — or phone number — on your account.'}
          leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#71717A" />}
        />
      </View>

      <Pressable
        onPress={submit}
        disabled={!canDelete}
        accessibilityRole="button"
        accessibilityLabel="Permanently delete my account"
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canDelete ? 'bg-danger active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Delete my account</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={close} disabled={busy} className="mt-2 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Keep my account</Text>
      </Pressable>
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable
          onPress={close}
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
