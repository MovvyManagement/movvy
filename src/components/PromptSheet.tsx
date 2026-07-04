// =============================================================================
// PromptSheet — cross-platform replacement for Alert.prompt (which is iOS-only,
// so any flow built on it is dead on Android). A bottom-sheet modal that
// collects one or more text fields, validates, and runs an async onSubmit.
//
// Same modal pattern as DeleteAccountSheet / the customer cancel sheet, so it
// works identically on iOS + Android in Expo Go.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from './Input';
import { haptic } from '@/lib/haptics';

const IS_IOS = Platform.OS === 'ios';

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  required?: boolean;
  minLength?: number;
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  fields: PromptField[];
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

export function PromptSheet({
  visible, title, message, fields, confirmLabel = 'Confirm', tone = 'default', onSubmit, onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset to each field's default every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = f.defaultValue ?? '';
    setValues(init);
    setError(null);
    // fields is stable per-open; intentionally not a dep to avoid resets on re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim();
      if (f.required && v.length === 0) return setError(`${f.label} is required.`);
      if (f.minLength && v.length < f.minLength) return setError(`${f.label} must be at least ${f.minLength} characters.`);
    }
    setError(null);
    setBusy(true);
    try {
      haptic.medium();
      await onSubmit(values);
      haptic.success();
      onClose();
    } catch (e: any) {
      haptic.error();
      setError(e?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={IS_IOS ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <SafeAreaView edges={['bottom']} className="rounded-t-3xl bg-white">
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
                {IS_IOS ? null : <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />}
                <Text className="text-lg font-bold text-ink-900">{title}</Text>
                {message ? <Text className="mt-1 text-sm text-silver-500 leading-5">{message}</Text> : null}

                <View className="mt-4 gap-3">
                  {fields.map((f) => (
                    <Input
                      key={f.key}
                      label={f.label}
                      placeholder={f.placeholder}
                      value={values[f.key] ?? ''}
                      onChangeText={(t) => {
                        setValues((prev) => ({ ...prev, [f.key]: t }));
                        if (error) setError(null);
                      }}
                      keyboardType={f.keyboardType}
                      multiline={f.multiline}
                      autoCapitalize="sentences"
                    />
                  ))}
                </View>

                {error ? <Text className="mt-3 text-xs text-danger">{error}</Text> : null}

                <Pressable
                  onPress={submit}
                  disabled={busy}
                  className={`mt-5 h-14 rounded-2xl items-center justify-center ${
                    busy ? 'bg-silver-300' : tone === 'danger' ? 'bg-danger active:opacity-90' : 'bg-brand-600 active:opacity-90'
                  }`}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-base font-bold text-white">{confirmLabel}</Text>}
                </Pressable>
                <Pressable onPress={close} disabled={busy} className="mt-2 h-11 items-center justify-center">
                  <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
                </Pressable>
              </ScrollView>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
