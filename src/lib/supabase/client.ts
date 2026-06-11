// Supabase client — singleton, uses SecureStore on device for token persistence.
// SecureStore is backed by iOS Keychain / Android Keystore (encrypted at rest).
//
// IMPORTANT: only the public `anon` key is allowed in this file. The service_role
// key never touches client code — it lives in Supabase Functions secrets.

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const SUPABASE_URL =
  (Constants.expoConfig?.extra?.SUPABASE_URL as string | undefined) ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  (Constants.expoConfig?.extra?.SUPABASE_ANON_KEY as string | undefined) ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Don't throw — let the UI degrade gracefully so dev can still navigate screens.
  // Real auth calls will surface a clear error from supabase-js.
  // eslint-disable-next-line no-console
  console.warn('[Movvy] SUPABASE_URL / SUPABASE_ANON_KEY missing — auth will be disabled.');
}

// SecureStore has a 2KB value limit. Supabase session JSON is small (~1KB) so safe.
// On web, fall back to localStorage.
const secureStorage = {
  getItem: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
      : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.setItem(key, value))
      : SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED,
        }),
  removeItem: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.removeItem(key))
      : SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '', {
  auth: {
    storage: secureStorage as any,
    autoRefreshToken: true,         // Rotate access token before expiry (1hr default)
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',               // PKCE = no client secret needed; secure for mobile
  },
  global: {
    headers: {
      'x-app': 'movvy-mobile',
      'x-app-version': (Constants.expoConfig?.version as string) ?? '0.0.0',
    },
  },
});

export const supabaseConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
