// =============================================================================
// /(auth)/partner-signin — "Already a partner / driver" sign-in
//
// Required for every partner login (drivers, movers, company members,
// dispatchers). The two-factor gate is:
//
//   1) email/phone + password  (proves you're you)
//   2) your team / company INVITE CODE (proves you're STILL on the roster)
//
// If the company removes a driver from the roster, or rotates the code, the
// driver can no longer sign in via this screen — even with valid credentials.
// This is the protection against "someone created an account once, now they
// keep signing in indefinitely even after we removed them."
//
// Customers have their own sign-in (/(auth)/login) — no code, no roster
// check. This screen is partner-only.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { loginPartner, supabaseConfigured } from '@/lib/supabase';

type ContactMethod = 'email' | 'phone';

export default function PartnerSignIn() {
  const [contactMethod, setContactMethod] = useState<ContactMethod>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Operator model: no invite code at sign-in — your credentials ARE your
  // access. The code is only for JOINING a crew, from the profile.
  const contactReady =
    contactMethod === 'email' ? email.includes('@') : isPhoneComplete(phone);
  const canSubmit = contactReady && password.length > 0;

  const submit = async () => {
    if (!supabaseConfigured) {
      Alert.alert(
        'Backend not configured',
        'Set EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
      );
      return;
    }
    setError(null);
    setLoading(true);
    // try/finally guarantees the button comes back to life even if the
    // helper throws (network error, bad RLS, etc).
    try {
      const res = await loginPartner({
        password,
        ...(contactMethod === 'email'
          ? { email: email.trim().toLowerCase() }
          : { phone: toE164(phone) }),
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not sign in.');
        return;
      }
      // Signed up but never finished creating their org → into onboarding.
      if (res.data?.needsOnboarding) {
        router.replace('/(company)/onboarding/operator' as any);
        return;
      }
      // Signed in but the owner hasn't approved them yet → waiting room.
      if (res.data?.status === 'pending_approval') {
        router.replace('/(auth)/pending-approval');
        return;
      }
      // Route by ROLE, not org type: only an org ADMIN gets the company
      // dashboard (prices, dispatch, assign). Crew — and legacy team members —
      // land on the crew surface, which shows jobs to accept + perform and
      // never shows dollar figures. This is what makes "the admin is the only
      // one who sees prices" true at the navigation level.
      const isAdmin = res.data?.kind === 'company' && res.data?.org_role === 'admin';
      router.replace(
        isAdmin ? '/(company)/(tabs)/dashboard' : '/(mover)/(tabs)/dashboard',
      );
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
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 px-6">
            <Text className="text-3xl font-bold text-ink-900">Partner sign-in</Text>
            <Text className="mt-2 text-base text-silver-500">
              Sign in with the email or phone and password you signed up with.
            </Text>

            {/* Contact method toggle */}
            <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              Sign in with
            </Text>
            <View className="flex-row rounded-2xl bg-silver-100 p-1">
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

            <View className="mt-4 gap-4">
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
                  hint="Use the phone you signed up / were invited with"
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

            {/* Same code-based reset as the customer side — ?side=partner just
                decides where they land once the new password is saved. */}
            <Pressable
              onPress={() => router.push('/(auth)/forgot-password?side=partner' as any)}
              className="mt-4 items-center"
            >
              <Text className="text-sm font-semibold text-brand-700">
                Forgot your password?
              </Text>
            </Pressable>

            {/* New here → sign up. Everyone signs up the same way and gets their
                own code; joining someone's crew happens later from the profile. */}
            <View className="mt-6 mb-4 flex-row items-center justify-center">
              <Text className="text-sm text-silver-500">New to Movvy? </Text>
              <Pressable onPress={() => router.push('/partner')}>
                <Text className="text-sm font-semibold text-brand-700">Create your account →</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
