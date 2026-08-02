// =============================================================================
// AddDriverSheet
//
// Post-onboarding "+ Add Driver" surface used from /(company)/drivers. The
// dispatcher types a driver's name + email (and optional phone), taps Invite,
// and partners-invite-send fires an SMS (if phone provided) and a branded
// HTML email containing the company's invite code + app store links.
//
// Mirrors the existing sheet design system — Modal pageSheet on iOS, slide-
// up on Android, identical to EditNameSheet / EditPhoneSheet / AddTruckSheet.
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
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { PhoneInput, isPhoneComplete, toE164 } from './PhoneInput';
import { useSendPartnerInvites, useCompany } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddDriverSheet({ visible, companyId, onClose }: Props) {
  const { data: company } = useCompany(companyId);
  const sendInvites = useSendPartnerInvites();
  const toast = useToast();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset state every time the sheet opens fresh — avoids leaving stale text
  // from the previous invite when the dispatcher opens it again.
  useEffect(() => {
    if (!visible) return;
    setFullName('');
    setEmail('');
    setPhone('');
  }, [visible]);

  const emailOk = EMAIL_RE.test(email.trim());
  const phoneOk = isPhoneComplete(phone);
  // Email is the primary channel since the user explicitly asked for "send
  // by email." Phone is optional — when present we also fire an SMS.
  const canSend =
    !!companyId &&
    fullName.trim().length >= 2 &&
    emailOk &&
    (phone.trim() === '' || phoneOk) &&
    !busy;

  const submit = async () => {
    if (!canSend || !companyId) return;
    setBusy(true);
    try {
      const result = await sendInvites.mutateAsync({
        company_id: companyId,
        invites: [
          {
            role: 'driver',
            full_name: fullName.trim(),
            email: email.trim().toLowerCase(),
            phone: phoneOk ? toE164(phone) : undefined,
          },
        ],
      });
      const row = result.results?.[0];
      if (row?.status === 'failed') {
        throw new Error(row.error ?? "Couldn't send the invite.");
      }
      haptic.success();
      const dispatchedVia =
        row?.channel === 'both'
          ? 'email + SMS'
          : row?.channel === 'sms'
          ? 'SMS'
          : 'email';
      toast.success(`Invite sent to ${fullName.trim()} via ${dispatchedVia}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not send the invite. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const companyName = company?.display_name ?? 'your company';
  const inviteCode = company?.invite_code ?? null;
  // Show the code without dashes (e.g. COR5AMHB). Join matching is dash-tolerant.
  const codeNoDash = inviteCode ? inviteCode.replace(/-/g, '').toUpperCase() : null;

  const shareInvite = async () => {
    if (!codeNoDash) return;
    Share.share({
      message:
        `You're invited to join ${companyName} on Movvy.\n\n` +
        `1. Download Movvy (App Store / Google Play)\n` +
        `2. Create your account\n` +
        `3. In your profile, tap "Join a crew" and enter code ${codeNoDash}\n\n` +
        `That's it — you'll be on the crew and can start taking moves.`,
    }).catch(() => {});
  };

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Invite a driver</Text>
      <Text className="mt-1 text-sm text-silver-500 leading-5">
        We'll email them the Movvy app links and your company code — they can
        sign in and start receiving job assignments as soon as Movvy verifies
        their ID + license.
      </Text>

      {/* Company-code preview — shows the dispatcher exactly what the driver
          will type to join. Same code printed on the invite email. */}
      {inviteCode ? (
        <View className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-4">
          <Text className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
            Driver will receive
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-base font-bold text-ink-900" numberOfLines={1}>
                {companyName}
              </Text>
              <Text className="text-xs text-silver-600 mt-0.5">Code · {codeNoDash}</Text>
            </View>
            <Pressable
              onPress={shareInvite}
              hitSlop={8}
              className="h-10 w-10 rounded-2xl bg-brand-600 items-center justify-center active:opacity-80"
            >
              <Ionicons name="paper-plane" size={18} color="#fff" />
            </Pressable>
          </View>
          <Text className="mt-2 text-[11px] text-silver-500">
            Tap the arrow to share a ready-to-send invite with your code.
          </Text>
        </View>
      ) : null}

      <View className="mt-5 gap-3">
        <Input
          label="Full legal name"
          placeholder="As it appears on their ID"
          autoCapitalize="words"
          autoCorrect={false}
          textContentType="name"
          value={fullName}
          onChangeText={setFullName}
          leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
        />
        <Input
          label="Email"
          placeholder="driver@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
          hint="Required. We'll email the app link + company code immediately."
        />
        <PhoneInput
          label="Phone (optional)"
          value={phone}
          onChangeText={setPhone}
          hint="When provided, we also text them a 1-tap join link."
        />
      </View>

      <Pressable
        onPress={submit}
        disabled={!canSend}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canSend ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
        accessibilityRole="button"
        accessibilityLabel="Send driver invite"
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="paper-plane" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Send invite</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
      </Pressable>

      <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row">
        <Ionicons name="information-circle-outline" size={18} color="#71717A" />
        <Text className="ml-2 flex-1 text-[11px] text-silver-500 leading-5">
          The driver doesn't have a Movvy account yet? No problem — the invite
          email walks them through downloading the app, entering your code,
          and uploading their license. You see them on the Drivers roster as
          soon as Movvy verifies them.
        </Text>
      </View>
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
