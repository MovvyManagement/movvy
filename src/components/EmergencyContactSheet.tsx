// =============================================================================
// EmergencyContactSheet
//
// Slide-up editor for the customer's emergency contact (name + E.164 phone).
// Used from the customer profile + nudged from the SOS screen when the
// field is missing. Backed by useUpdateEmergencyContact which patches
// profiles.emergency_contact_name / _phone with the format constraint
// added in migration 0028.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';
import { PhoneInput, isPhoneComplete, toE164 } from './PhoneInput';
import { useUpdateEmergencyContact, useProfile } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function EmergencyContactSheet({ visible, onClose }: Props) {
  const { data: profile } = useProfile();
  const update = useUpdateEmergencyContact();
  const toast = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed local state every time the sheet opens — keeps it in sync
  // with the latest profile + lets the user "cancel" cleanly.
  useEffect(() => {
    if (!visible) return;
    setName(profile?.emergency_contact_name ?? '');
    // Strip the leading +1 — the PhoneInput component adds it back at submit.
    const stored = profile?.emergency_contact_phone ?? '';
    setPhone(stored.startsWith('+1') ? stored.slice(2) : stored.replace(/^\+/, ''));
  }, [visible, profile]);

  const phoneOk = phone === '' || isPhoneComplete(phone);
  const canSave = phoneOk && (name.trim().length === 0 || name.trim().length > 1);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        name: name.trim() || null,
        phone: phone ? toE164(phone) : null,
      });
      haptic.success();
      toast.success('Emergency contact saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save your contact.");
    } finally {
      setSaving(false);
    }
  };

  const removeContact = () => {
    Alert.alert(
      'Remove emergency contact?',
      'They won\'t be notified if you hit SOS.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await update.mutateAsync({ name: null, phone: null });
              toast.success('Emergency contact removed');
              onClose();
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't remove.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }}>
              <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />

              <Text className="text-xl font-bold text-ink-900">Emergency contact</Text>
              <Text className="mt-1 text-sm text-silver-500">
                If you hit SOS during a move, we SMS this person immediately
                alongside notifying Movvy support. Choose someone reliable —
                family, partner, close friend.
              </Text>

              <View className="mt-5 gap-3">
                <Input
                  label="Name"
                  placeholder="Their name"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
                />
                <PhoneInput
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  hint="Canadian or US mobile — we SMS them in plain English."
                />
              </View>

              <View className="mt-5 rounded-2xl bg-silver-50 p-3 flex-row items-start">
                <Ionicons name="lock-closed-outline" size={14} color="#71717A" />
                <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
                  Only sent when YOU trigger SOS. We never message them for
                  marketing, billing, or "move complete" updates.
                </Text>
              </View>

              <Pressable
                onPress={save}
                disabled={!canSave || saving}
                className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
                  canSave && !saving
                    ? 'bg-brand-600 active:opacity-90'
                    : 'bg-silver-300'
                }`}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text className="ml-2 text-base font-bold text-white">Save contact</Text>
                  </>
                )}
              </Pressable>

              {profile?.emergency_contact_phone ? (
                <Pressable
                  onPress={removeContact}
                  className="mt-2 h-12 items-center justify-center"
                >
                  <Text className="text-sm font-semibold text-danger">
                    Remove emergency contact
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
                  <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
                </Pressable>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
