// =============================================================================
// EditTeamBankSheet
//
// Driver-side parallel to EditBankAccountSheet (company). Captures Canadian
// bank routing metadata for a partner team — Movvy uses it to push weekly
// payouts until Stripe Connect lands in Phase 3. The full account number is
// taken for visual confirmation, the last-four derived, and the rest dropped
// before save.
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
import { useTeam, useUpdateTeam } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  teamId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function EditTeamBankSheet({ visible, teamId, onClose }: Props) {
  const { data: team } = useTeam(teamId);
  const update = useUpdateTeam(teamId);
  const toast = useToast();

  const [holder, setHolder] = useState('');
  const [institution, setInstitution] = useState('');
  const [transit, setTransit] = useState('');
  // Held in memory only — derived to last-4, then discarded.
  const [accountRaw, setAccountRaw] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !team) return;
    setHolder(team.bank_holder_name ?? team.display_name ?? '');
    setInstitution(team.bank_institution_number ?? '');
    setTransit(team.bank_transit_number ?? '');
    setAccountRaw('');
  }, [visible, team]);

  const valid =
    !!team &&
    !saving &&
    holder.trim().length >= 2 &&
    /^[0-9]{3}$/.test(institution.trim()) &&
    /^[0-9]{5}$/.test(transit.trim()) &&
    /^[0-9]{6,12}$/.test(accountRaw.trim());

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const cleaned = accountRaw.trim();
      const last4 = cleaned.slice(-4);
      await update.mutateAsync({
        bank_holder_name: holder.trim(),
        bank_institution_number: institution.trim(),
        bank_transit_number: transit.trim(),
        bank_account_last4: last4,
        bank_updated_at: new Date().toISOString(),
      });
      setAccountRaw('');
      haptic.success();
      toast.success('Bank details saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save bank details.");
    } finally {
      setSaving(false);
    }
  };

  const hasExisting = !!team?.bank_account_last4;

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Bank account</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Where Movvy sends your weekly payout. Canadian banks only. Your account
        number is used to derive the last-four shown below, then discarded —
        only the routing metadata is saved.
      </Text>

      {hasExisting ? (
        <View className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-4">
          <View className="flex-row items-center">
            <Ionicons name="shield-checkmark" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">
              Account on file · •••• {team?.bank_account_last4}
            </Text>
          </View>
          <Text className="mt-1 text-xs text-silver-600">
            {team?.bank_holder_name} · Institution {team?.bank_institution_number} ·
            Transit {team?.bank_transit_number}
          </Text>
        </View>
      ) : null}

      <View className="mt-5 gap-3">
        <Input
          label="Account holder name"
          placeholder="Your legal name"
          autoCapitalize="words"
          value={holder}
          onChangeText={setHolder}
          leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
        />
        <View className="flex-row gap-3">
          <View style={{ flex: 1 }}>
            <Input
              label="Institution #"
              placeholder="003"
              keyboardType="number-pad"
              maxLength={3}
              value={institution}
              onChangeText={(t) => setInstitution(t.replace(/[^0-9]/g, '').slice(0, 3))}
              hint="3 digits"
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <Input
              label="Transit #"
              placeholder="12345"
              keyboardType="number-pad"
              maxLength={5}
              value={transit}
              onChangeText={(t) => setTransit(t.replace(/[^0-9]/g, '').slice(0, 5))}
              hint="5 digits"
            />
          </View>
        </View>
        <Input
          label="Account number"
          placeholder="•••••••••"
          keyboardType="number-pad"
          secureTextEntry
          value={accountRaw}
          onChangeText={(t) => setAccountRaw(t.replace(/[^0-9]/g, '').slice(0, 12))}
          leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#71717A" />}
          hint="6–12 digits. Only the last 4 are stored; full number is discarded on save."
        />
      </View>

      <Pressable
        onPress={save}
        disabled={!valid}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          valid ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">
              {hasExisting ? 'Replace account' : 'Save bank details'}
            </Text>
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
