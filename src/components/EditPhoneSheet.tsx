// =============================================================================
// EditPhoneSheet
//
// Two-step phone editor: enter number → enter SMS verification code → save.
// We try Supabase Auth's built-in phone-change OTP first (real SMS via the
// configured provider). When SMS isn't wired (no Twilio yet), we fall back
// to a local 6-digit code shown via Alert so the flow stays exercisable in
// dev. The mock is dev-only — production with SMS configured uses the real
// auth.users phone_change flow and the matching verifyOtp() call.
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
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { PhoneInput, isPhoneComplete, toE164 } from './PhoneInput';
import { useProfile, useUpdateProfile } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

type Step = 'enter' | 'verify';
type VerifyMode = 'auth' | 'mock';

function generateMockOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Heuristic: treat any auth error mentioning "phone provider" / "sms" / "twilio"
 *  as "SMS isn't configured" and silently fall back to the local mock OTP. */
function isSmsUnconfigured(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes('phone provider') ||
    m.includes('sms') ||
    m.includes('twilio') ||
    m.includes('not enabled') ||
    m.includes('disabled')
  );
}

export function EditPhoneSheet({ visible, onClose }: Props) {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const toast = useToast();

  const [step, setStep] = useState<Step>('enter');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [mode, setMode] = useState<VerifyMode>('mock');
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Strip +1 so the PhoneInput pre-fills cleanly; it re-adds it via toE164.
  useEffect(() => {
    if (!visible) return;
    const stored = profile?.phone ?? '';
    setPhone(stored.startsWith('+1') ? stored.slice(2) : stored.replace(/^\+/, ''));
    setStep('enter');
    setOtp('');
    setMockCode(null);
  }, [visible, profile?.phone]);

  const e164 = phone ? toE164(phone) : '';
  const canSend = isPhoneComplete(phone) && !sending;
  const canVerify = otp.replace(/\D/g, '').length === 6 && !verifying;

  const sendCode = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      // Real path: ask Supabase Auth to send an OTP to the new phone. This
      // updates auth.users.phone_change_token and texts the code via the
      // configured SMS provider.
      const { error } = await supabase.auth.updateUser({ phone: e164 });
      if (error) {
        if (isSmsUnconfigured(error.message)) {
          // Mock path — generate locally + show via alert so the dev can
          // exercise the full flow without Twilio.
          const code = generateMockOtp();
          setMockCode(code);
          setMode('mock');
          haptic.light();
          Alert.alert(
            'Verification code',
            `SMS isn't enabled yet, so here's your code in dev:\n\n${code}`,
          );
          setStep('verify');
          return;
        }
        throw error;
      }
      setMode('auth');
      haptic.success();
      toast.success(`Code sent to ${e164}`);
      setStep('verify');
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the code.");
    } finally {
      setSending(false);
    }
  };

  const verifyAndSave = async () => {
    if (!canVerify) return;
    setVerifying(true);
    try {
      const token = otp.replace(/\D/g, '');
      if (mode === 'mock') {
        if (token !== mockCode) throw new Error('Incorrect code — try again.');
      } else {
        const { error } = await supabase.auth.verifyOtp({
          phone: e164,
          token,
          type: 'phone_change',
        });
        if (error) throw error;
      }
      // OTP confirmed — persist to profiles.phone so the rest of the app
      // (driver SMS handoffs, receipts, audit logs) sees the new number.
      await update.mutateAsync({ phone: e164 });
      haptic.success();
      toast.success('Phone verified');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't verify that code.");
    } finally {
      setVerifying(false);
    }
  };

  // ─── UI ──────────────────────────────────────────────────────────────────

  const enterStep = (
    <>
      <Text className="text-2xl font-bold text-ink-900">Phone number</Text>
      <Text className="mt-1 text-sm text-silver-500">
        We'll text a 6-digit code to verify it's really your number before
        we save it. Canadian or US mobile only.
      </Text>

      <View className="mt-5">
        <PhoneInput
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          hint="Carrier SMS rates may apply."
        />
      </View>

      <Pressable
        onPress={sendCode}
        disabled={!canSend}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canSend ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {sending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="send" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Send verification code</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
      </Pressable>
    </>
  );

  const verifyStep = (
    <>
      <Pressable
        onPress={() => setStep('enter')}
        accessibilityRole="button"
        accessibilityLabel="Back to phone entry"
        hitSlop={6}
        className="self-start h-10 w-10 rounded-full bg-silver-100 items-center justify-center"
      >
        <Ionicons name="chevron-back" size={20} color="#0A0A0A" />
      </Pressable>

      <Text className="mt-3 text-2xl font-bold text-ink-900">Enter the code</Text>
      <Text className="mt-1 text-sm text-silver-500">
        We sent a 6-digit code to <Text className="font-bold text-ink-900">{e164}</Text>.
        Enter it below to finish updating your number.
      </Text>

      <View className="mt-5">
        <Input
          label="6-digit code"
          placeholder="123456"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          leftIcon={<Ionicons name="keypad-outline" size={18} color="#71717A" />}
        />
      </View>

      <Pressable
        onPress={verifyAndSave}
        disabled={!canVerify}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canVerify ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {verifying ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Verify & save</Text>
          </>
        )}
      </Pressable>

      <Pressable
        onPress={sendCode}
        disabled={sending}
        className="mt-2 h-12 items-center justify-center"
      >
        <Text className="text-sm font-semibold text-brand-700">
          {sending ? 'Sending…' : 'Resend code'}
        </Text>
      </Pressable>
    </>
  );

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}
      {step === 'enter' ? enterStep : verifyStep}
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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
