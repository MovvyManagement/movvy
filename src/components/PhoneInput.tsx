// =============================================================================
// PhoneInput
//
// Phone input with a fixed, uneditable "+1" country-code prefix. Movvy
// launches in Canada and is rolling into the US next — both use +1, so we
// hard-code the prefix and let the user type only the 10-digit local number.
//
// State contract:
//   • parent owns `value` as the DIGITS-ONLY local number, e.g. "4035550100"
//   • this component displays "(403) 555-0100" with "+1" pinned on the left
//   • parent composes the E.164 string for the backend as `toE164(value)`
//     which returns "+14035550100" (matches PhoneE164 in validation/schemas.ts)
//
// When you expand outside +1 territory, swap this for a country-picker input.
// =============================================================================

import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './Input';

/** Strip everything except digits, capped at 10 local-number characters. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10);
}

/** Pretty-print a 0–10 digit local number as the user types. */
export function formatPhoneDisplay(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Compose an E.164 string from the digits-only local number. */
export function toE164(digits: string): string {
  return `+1${digitsOnly(digits)}`;
}

/** True when the local number has all 10 digits filled in. */
export function isPhoneComplete(digits: string): boolean {
  return digitsOnly(digits).length === 10;
}

interface Props {
  /** Digits-only local number (no +1, no formatting). */
  value: string;
  /** Receives digits-only — parent should pass it back as `value`. */
  onChangeText: (digits: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
}

export function PhoneInput({
  value,
  onChangeText,
  label = 'Phone',
  hint,
  error,
  placeholder = '(403) 555-0100',
}: Props) {
  return (
    <Input
      label={label}
      hint={hint}
      error={error}
      placeholder={placeholder}
      value={formatPhoneDisplay(value)}
      onChangeText={(text) => onChangeText(digitsOnly(text))}
      keyboardType="phone-pad"
      autoComplete="tel"
      maxLength={14 /* "(403) 555-0100" = 14 chars */}
      leftIcon={
        <View className="flex-row items-center">
          <Ionicons name="call-outline" size={18} color="#71717A" />
          <Text className="ml-2 mr-2 text-base font-semibold text-ink-900">+1</Text>
          <View className="h-5 w-px bg-silver-200" />
        </View>
      }
    />
  );
}
