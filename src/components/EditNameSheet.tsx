// =============================================================================
// EditNameSheet
//
// Two-field editor (First + Last) for the customer's display name. We
// concatenate to profiles.full_name on save because the rest of the app
// already reads full_name (home greeting splits on whitespace for the
// first name, Avatar derives initials from the same string).
//
// Saving here invalidates the profile cache via useUpdateProfile.onSuccess
// → every consumer (home, profile, bookings, chat, receipts) re-renders
// with the new name on the next React commit. No manual broadcast needed.
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
import { useProfile, useUpdateProfile } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

// Split a stored full_name back into first/last so the editor pre-fills
// correctly. Anything past the first space becomes the last name, so
// "Sarah Connor Doe" parses to first="Sarah", last="Connor Doe".
function splitName(full: string | null | undefined): { first: string; last: string } {
  const v = (full ?? '').trim();
  if (!v) return { first: '', last: '' };
  const idx = v.indexOf(' ');
  if (idx === -1) return { first: v, last: '' };
  return { first: v.slice(0, idx), last: v.slice(idx + 1).trim() };
}

export function EditNameSheet({ visible, onClose }: Props) {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const toast = useToast();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const split = splitName(profile?.full_name);
    setFirst(split.first);
    setLast(split.last);
  }, [visible, profile?.full_name]);

  const firstTrim = first.trim();
  const lastTrim = last.trim();
  const combined = [firstTrim, lastTrim].filter(Boolean).join(' ');
  const original = (profile?.full_name ?? '').trim();
  const canSave =
    firstTrim.length >= 2 && lastTrim.length >= 1 && combined !== original && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await update.mutateAsync({ full_name: combined });
      haptic.success();
      toast.success('Name updated');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update your name.");
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Hand-drawn drag handle is Android-only — iOS pageSheet renders the
          system grabber natively, so showing ours too gives a duplicate. */}
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Personal info</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Update the name your driver and crew see. Use your real name —
        it's printed on your booking and receipt, and shows everywhere in
        the app the moment you save.
      </Text>

      <View className="mt-5 gap-3">
        <Input
          label="First name"
          placeholder="Sarah"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          value={first}
          onChangeText={setFirst}
          leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
        />
        <Input
          label="Last name"
          placeholder="Connor"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
          value={last}
          onChangeText={setLast}
        />
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
            <Text className="ml-2 text-base font-bold text-white">Save changes</Text>
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
