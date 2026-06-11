import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { Button } from '@/components/Button';
import { signupCustomer, supabaseConfigured } from '@/lib/supabase';
import { TERMS_VERSION } from '@/lib/brand';

// =============================================================================
// Partner signup — single sign-up form for solo crews AND moving companies.
// Replaces the old "How will you use Movvy?" card picker.
//
// Step 1 of 5 in the partner onboarding journey:
//   1. Account (this screen)
//   2. Either:
//        Solo crew  → /(mover)/onboarding/personal
//        Company    → /(company)/onboarding/company-info
//   3-5. Vehicle/Drivers → Documents → Pending review
// =============================================================================

type PartnerKind = 'solo' | 'company';

export default function PartnerSignup() {
  const [kind, setKind] = useState<PartnerKind>('solo');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 1 &&
    email.includes('@') &&
    isPhoneComplete(phone) &&
    password.length >= 10 &&
    acceptTerms;

  const continueOnboarding = () => {
    if (kind === 'solo') router.replace('/(mover)/onboarding/personal');
    else router.replace('/(company)/onboarding/company-info');
  };

  const submit = async () => {
    if (!supabaseConfigured) {
      // Demo / no-keys path: skip auth, jump to onboarding
      continueOnboarding();
      return;
    }
    setError(null);
    setLoading(true);
    // Reuses the customer signup helper but flags role via metadata.
    // The DB trigger `handle_new_user` reads `role` from raw_user_meta_data.
    const role = kind === 'solo' ? 'driver' : 'company_owner';
    const res = await (await import('@/lib/supabase/client')).supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          phone: toE164(phone),
          role,
          // Same terms-acceptance fields as the customer signup so the
          // handle_new_user trigger writes both into profiles regardless
          // of role.
          terms_accepted_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      },
    });
    setLoading(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    Alert.alert(
      'Check your email',
      "We sent you a verification link. Tap it, then come back to finish your partner profile.",
      [{ text: 'Continue setup', onPress: continueOnboarding }],
    );
  };

  return (
    <View className="flex-1 bg-white">
      <LinearGradient
        colors={['#ECFDF5', '#FFFFFF']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200 }}
      />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScreenHeader />
          <StepIndicator step={1} total={5} label="Create your partner account" />

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="mt-2">
              <View className="self-start rounded-full bg-brand-600 px-3 py-1">
                <Text className="text-white text-[11px] font-bold uppercase tracking-wider">
                  Movvy Partner
                </Text>
              </View>
              <Text className="mt-3 text-3xl font-bold text-ink-900 leading-9">
                Join Movvy.{'\n'}Start earning.
              </Text>
              <Text className="mt-2 text-base text-silver-500 leading-6">
                Same account whether you're a 2-person crew or a fleet operator. Pick which one you
                are and we'll tailor the rest.
              </Text>
            </View>

            {/* Kind selector — solo crew vs moving company */}
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
              I'm signing up as a…
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setKind('solo')}
                className={`flex-1 rounded-3xl border p-4 ${
                  kind === 'solo' ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                }`}
              >
                <Ionicons
                  name="people"
                  size={22}
                  color={kind === 'solo' ? '#047857' : '#0A0A0A'}
                />
                <Text className="mt-2 text-base font-bold text-ink-900">Solo crew</Text>
                <Text className="text-xs text-silver-500 mt-1">2-person team · 1 driver + 1 mover</Text>
              </Pressable>
              <Pressable
                onPress={() => setKind('company')}
                className={`flex-1 rounded-3xl border p-4 ${
                  kind === 'company' ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                }`}
              >
                <Ionicons
                  name="business"
                  size={22}
                  color={kind === 'company' ? '#047857' : '#0A0A0A'}
                />
                <Text className="mt-2 text-base font-bold text-ink-900">Moving company</Text>
                <Text className="text-xs text-silver-500 mt-1">Fleet · multiple drivers</Text>
              </Pressable>
            </View>

            {/* Account form — same fields as customer signup */}
            <View className="mt-6 gap-4">
              <Input
                label="Full name"
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
              />
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
              <PhoneInput
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                hint="Used for proxy calls/SMS with customers"
              />
              <Input
                label="Password"
                placeholder="At least 10 characters · upper, lower, number"
                secureTextEntry
                autoComplete="new-password"
                value={password}
                onChangeText={setPassword}
                leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#71717A" />}
              />
            </View>

            <Pressable
              onPress={() => setAcceptTerms((v) => !v)}
              className="mt-5 flex-row items-start active:opacity-70"
            >
              <View
                className={`mt-0.5 mr-3 h-5 w-5 rounded border-2 items-center justify-center ${
                  acceptTerms ? 'border-brand-600 bg-brand-600' : 'border-silver-300 bg-white'
                }`}
              >
                {acceptTerms ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              </View>
              <Text className="flex-1 text-xs text-silver-500 leading-5">
                I agree to Movvy's{' '}
                <Link
                  href="/(legal)/terms"
                  className="text-brand-700 font-semibold"
                  onPress={(e) => e.stopPropagation()}
                >
                  Partner Terms
                </Link>
                ,{' '}
                <Link
                  href="/(legal)/terms"
                  className="text-brand-700 font-semibold"
                  onPress={(e) => e.stopPropagation()}
                >
                  Background Check Consent
                </Link>
                , and{' '}
                <Link
                  href="/(legal)/terms"
                  className="text-brand-700 font-semibold"
                  onPress={(e) => e.stopPropagation()}
                >
                  Privacy Policy
                </Link>
                .
              </Text>
            </Pressable>

            {error ? (
              <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
                <Ionicons name="alert-circle" size={18} color="#EF4444" />
                <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
              </View>
            ) : null}

            <View className="my-4 rounded-2xl bg-silver-50 p-4">
              <Text className="text-[11px] text-silver-500 leading-5">
                After you create the account you'll be guided through {kind === 'solo' ? 'team setup, vehicle, and document verification' : 'company info, driver roster, and document verification'} — usually approved within 24–48 hours.
              </Text>
            </View>
          </ScrollView>

          <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
            <Button
              label={canSubmit ? 'Create partner account' : 'Fill every field to continue'}
              size="lg"
              fullWidth
              loading={loading}
              disabled={!canSubmit}
              onPress={submit}
            />
            {/* Single sign-in entry for partners. Goes to partner-signin —
                the only screen where code + email/phone + password are
                collected. Brand-new invited drivers (no account yet) get
                routed from partner-signin's own "Don't have an account?"
                cross-link to the create-from-invite flow. */}
            <View className="mt-3 flex-row items-center justify-center">
              <Text className="text-xs text-silver-500">Already a partner? </Text>
              <Link
                href="/(auth)/partner-signin"
                className="text-xs font-semibold text-brand-700"
              >
                Sign in with team code →
              </Link>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
