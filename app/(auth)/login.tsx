import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { login, supabaseConfigured } from '@/lib/supabase';
import { useToast } from '@/components/Toast';

// =============================================================================
// Sign in — accepts EITHER an email or a phone number, matching the signup
// screen's two-tab pattern. The toggle at the top sets which one is used;
// the helper (lib/supabase/auth.ts) routes the appropriate field to
// supabase.auth.signInWithPassword.
//
// Phone sign-in requires Twilio to be wired into Supabase Auth — until then,
// Supabase returns "phone provider disabled", which auth.ts translates into a
// friendly fallback message ("Use email for now").
// =============================================================================

type ContactMethod = 'email' | 'phone';

export default function Login() {
  const [contactMethod, setContactMethod] = useState<ContactMethod>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `phone` state holds the 10-digit local number ONLY ("4035550100").
  // <PhoneInput /> renders "+1" as a fixed prefix; toE164() reattaches it
  // before we hand off to supabase.auth.signInWithPassword.
  const contactReady =
    contactMethod === 'email' ? email.includes('@') : isPhoneComplete(phone);
  const canSubmit = contactReady && password.length > 0;

  const toast = useToast();

  const submit = async () => {
    if (!supabaseConfigured) {
      Alert.alert('Backend not configured', 'Set EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
      return;
    }
    setError(null);
    setLoading(true);
    // try/finally guarantees setLoading(false) runs even if login() throws
    // (network error, edge-fn 500, etc). Without this, an exception
    // bubbles up and the button stays stuck in the spinner state.
    try {
      const res =
        contactMethod === 'email'
          ? await login({ email, password })
          : await login({ phone: toE164(phone), password });
      if (!res.ok) {
        setError(res.error ?? 'Could not sign in.');
        return;
      }
      router.replace('/(customer)/(tabs)/home');
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScreenHeader />
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6">
            <Text className="text-3xl font-bold text-ink-900">Welcome back</Text>
            <Text className="mt-2 text-base text-silver-500">
              Sign in with email or phone — whichever you used to create your account.
            </Text>

            {/* Contact method toggle — identical pattern to signup screen */}
            <View className="mt-6 flex-row rounded-2xl bg-silver-100 p-1">
              <Pressable
                onPress={() => setContactMethod('email')}
                className={`flex-1 rounded-xl py-2.5 items-center ${
                  contactMethod === 'email' ? 'bg-white' : ''
                }`}
              >
                <Text
                  className={`text-sm font-bold ${
                    contactMethod === 'email' ? 'text-ink-900' : 'text-silver-500'
                  }`}
                >
                  Email
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setContactMethod('phone')}
                className={`flex-1 rounded-xl py-2.5 items-center ${
                  contactMethod === 'phone' ? 'bg-white' : ''
                }`}
              >
                <Text
                  className={`text-sm font-bold ${
                    contactMethod === 'phone' ? 'text-ink-900' : 'text-silver-500'
                  }`}
                >
                  Phone
                </Text>
              </Pressable>
            </View>

            <View className="mt-6 gap-4">
              {contactMethod === 'email' ? (
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
                />
              ) : (
                <PhoneInput
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  hint="Use the same number you signed up with"
                />
              )}

              <Input
                label="Password"
                placeholder="Your password"
                secureTextEntry={!showPw}
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
                leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#71717A" />}
                rightIcon={
                  <Pressable onPress={() => setShowPw((s) => !s)}>
                    <Ionicons
                      name={showPw ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#71717A"
                    />
                  </Pressable>
                }
              />
              <View className="items-end">
                <Link href="/(auth)/forgot-password" className="text-sm font-semibold text-brand-700">
                  Forgot password?
                </Link>
              </View>
            </View>

            {error ? (
              <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
                <Ionicons name="alert-circle" size={18} color="#EF4444" />
                <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
              </View>
            ) : null}

            <View className="mt-6">
              <Button
                label="Sign in"
                size="lg"
                fullWidth
                loading={loading}
                disabled={!canSubmit}
                onPress={submit}
              />
            </View>

            <View className="mt-8 flex-row items-center justify-center">
              <Text className="text-sm text-silver-500">New to Movvy? </Text>
              <Link href="/(auth)/signup" className="text-sm font-semibold text-brand-700">
                Create an account
              </Link>
            </View>

            {/* Partner cross-link — drivers / movers / dispatchers need the
                team/company code at sign-in, so they go to a separate flow. */}
            <View className="mt-4 mb-4 rounded-2xl bg-silver-50 border border-silver-200 p-3 flex-row items-center">
              <Ionicons name="business-outline" size={16} color="#047857" />
              <Text className="ml-2 flex-1 text-xs text-silver-600">
                Driver, mover, or company member?
              </Text>
              <Link
                href="/(auth)/partner-signin"
                className="text-xs font-semibold text-brand-700"
              >
                Partner sign-in →
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
