// =============================================================================
// EditBankAccountSheet
//
// Captures Canadian bank-routing info for the company (display metadata
// only — the full account number is taken for visual confirmation, the
// last-four derived, and the rest dropped before save).
//
// Stripe Connect will replace this in Phase 3. Until then, the same row
// holds the routing info Movvy needs to push manual payouts.
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
import { useCompany, useUpdateCompany, useMyCompanyBankDetails } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function EditBankAccountSheet({ visible, companyId, onClose }: Props) {
  const { data: company } = useCompany(companyId);
  // Bank details no longer come off the companies row — the payment-destination
  // columns are revoked from `authenticated` (0119) because RLS grants whole
  // rows, so a members-can-read policy handed every hourly crew member their
  // admin's account details. This RPC returns nothing to anyone but an org admin.
  const { data: bank } = useMyCompanyBankDetails(companyId);
  const update = useUpdateCompany(companyId);
  const toast = useToast();

  const [holder, setHolder] = useState('');
  const [institution, setInstitution] = useState('');
  const [transit, setTransit] = useState('');
  // Stored only in memory — derived to last-4 then discarded on save.
  const [accountRaw, setAccountRaw] = useState('');
  // Interac e-Transfer email — an alternative payout method to bank wire.
  const [etransfer, setEtransfer] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setHolder(bank?.bank_holder_name ?? company?.legal_name ?? '');
    setInstitution(bank?.bank_institution_number ?? '');
    setTransit(bank?.bank_transit_number ?? '');
    setAccountRaw('');
    setEtransfer(bank?.etransfer_email ?? '');
  }, [visible, company, bank]);

  const emailOk = etransfer.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(etransfer.trim());
  // A fresh bank entry needs all four fields. If none is being entered we keep
  // whatever's on file (so someone can add an e-transfer email without
  // re-typing their account number).
  const bankEntered =
    accountRaw.trim().length > 0 ||
    institution.trim().length > 0 ||
    transit.trim().length > 0;
  const bankComplete =
    holder.trim().length >= 2 &&
    /^[0-9]{3}$/.test(institution.trim()) &&
    /^[0-9]{5}$/.test(transit.trim()) &&
    /^[0-9]{6,12}$/.test(accountRaw.trim());
  const hasExisting = !!bank?.bank_account_last4;

  const valid =
    !!company &&
    !saving &&
    emailOk &&
    // Need at least one usable payout method after saving.
    (bankComplete ||
      ((!bankEntered) && (hasExisting || etransfer.trim().length > 0)));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        etransfer_email: etransfer.trim() ? etransfer.trim().toLowerCase() : null,
      };
      // Only touch the bank fields when a complete new account was entered.
      if (bankEntered && bankComplete) {
        patch.bank_holder_name = holder.trim();
        patch.bank_institution_number = institution.trim();
        patch.bank_transit_number = transit.trim();
        patch.bank_account_last4 = accountRaw.trim().slice(-4);
        patch.bank_updated_at = new Date().toISOString();
      }
      await update.mutateAsync(patch);
      setAccountRaw('');  // drop the full PAN from memory the moment save lands
      haptic.success();
      toast.success('Payout details saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save payout details.");
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

      <Text className="text-2xl font-bold text-ink-900">Bank account</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Where Movvy sends your weekly payout. Canadian banks only. Your
        account number is used to derive the last-four shown below, then
        discarded — only the routing metadata is saved.
      </Text>

      {hasExisting ? (
        <View className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-4">
          <View className="flex-row items-center">
            <Ionicons name="shield-checkmark" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">
              Account on file · •••• {bank?.bank_account_last4}
            </Text>
          </View>
          <Text className="mt-1 text-xs text-silver-600">
            {bank?.bank_holder_name} · Institution {bank?.bank_institution_number} ·
            Transit {bank?.bank_transit_number}
          </Text>
        </View>
      ) : null}

      <View className="mt-5 gap-3">
        <Input
          label="Account holder name"
          placeholder="Movvy Movers Ltd."
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

      {/* Interac e-Transfer — an alternative to bank wire. Either method (or
          both) is fine; you can save just this without bank details. */}
      <View className="mt-6 flex-row items-center">
        <View className="h-px flex-1 bg-silver-200" />
        <Text className="mx-3 text-xs font-semibold uppercase tracking-wider text-silver-400">
          or Interac e-Transfer
        </Text>
        <View className="h-px flex-1 bg-silver-200" />
      </View>
      <View className="mt-4">
        <Input
          label="e-Transfer email"
          placeholder="payouts@yourcompany.ca"
          keyboardType="email-address"
          autoCapitalize="none"
          value={etransfer}
          onChangeText={setEtransfer}
          leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
          hint="Movvy can send your payout by Interac e-Transfer to this address."
          error={emailOk ? undefined : 'Enter a valid email'}
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
