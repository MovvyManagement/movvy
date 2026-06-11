// =============================================================================
// EditTaxInfoSheet
//
// Captures the partner team's GST/HST registration number. Printed on every
// invoice + receipt issued under the team. Optional — many independent
// operators aren't registered yet — but having it on file removes the
// "where do I send a tax form?" support thread.
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

// 9 digits + RT/RP/RC + 4 digits — same CRA format the DB CHECK enforces.
const GST_RE = /^[0-9]{9}(RT|RP|RC)[0-9]{4}$/;

export function EditTaxInfoSheet({ visible, teamId, onClose }: Props) {
  const { data: team } = useTeam(teamId);
  const update = useUpdateTeam(teamId);
  const toast = useToast();

  const [gst, setGst] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !team) return;
    setGst(team.gst_number ?? '');
  }, [visible, team]);

  const cleaned = gst.trim().toUpperCase().replace(/\s+/g, '');
  const matchesFormat = cleaned === '' || GST_RE.test(cleaned);
  const changed = cleaned !== (team?.gst_number ?? '');
  const canSave = !!team && !saving && matchesFormat && changed;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await update.mutateAsync({ gst_number: cleaned === '' ? null : cleaned });
      haptic.success();
      toast.success('Tax info saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save tax info.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!team || !team.gst_number || saving) return;
    setSaving(true);
    try {
      await update.mutateAsync({ gst_number: null });
      setGst('');
      haptic.success();
      toast.success('Tax number removed');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove tax info.");
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

      <Text className="text-2xl font-bold text-ink-900">Tax info</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Your GST/HST registration number prints on every receipt and invoice
        your team issues. Leave blank if you're not registered yet — Movvy
        won't collect tax on your behalf until you fill this in.
      </Text>

      <View className="mt-5 gap-3">
        <Input
          label="GST / HST number"
          placeholder="123456789RT0001"
          autoCapitalize="characters"
          autoCorrect={false}
          value={gst}
          onChangeText={setGst}
          leftIcon={<Ionicons name="receipt-outline" size={18} color="#71717A" />}
          hint="Format: 9 digits + RT + 4 digits."
        />
        {!matchesFormat ? (
          <View className="rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
            <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
            <Text className="ml-2 flex-1 text-xs text-danger leading-5">
              That doesn't look like a valid GST/HST number. Should be 9 digits,
              then RT, then 4 digits — e.g. 123456789RT0001.
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row">
        <Ionicons name="information-circle-outline" size={18} color="#71717A" />
        <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
          You can find your number on any CRA correspondence or in your
          business's My Business Account. T4A slips Movvy issues at year-end
          will use this same number.
        </Text>
      </View>

      <Pressable
        onPress={save}
        disabled={!canSave}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canSave ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Save tax info</Text>
          </>
        )}
      </Pressable>

      {team?.gst_number ? (
        <Pressable
          onPress={remove}
          disabled={saving}
          className="mt-2 h-12 items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel="Remove tax number"
        >
          <Text className="text-sm font-semibold text-danger">Remove tax number</Text>
        </Pressable>
      ) : null}

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
