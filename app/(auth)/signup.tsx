import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { signInWithApple, useGoogleSignIn } from '@/lib/oauth';
import { useToast } from '@/components/Toast';
import { TERMS_VERSION } from '@/lib/brand';

type ContactMethod = 'email' | 'phone';

// =============================================================================
// Customer signup — email OR phone (one is required, chosen one is verified).
//
// • Email path → Supabase sends confirmation link
// • Phone path → Supabase sends SMS OTP (requires Twilio in Supabase Auth)
//
// Until Twilio is wired into Supabase Auth, the phone path will return an
// error from the auth call ("phone provider not enabled"); UI shows the error.
// =============================================================================

export default function Signup() {
  const [contactMethod, setContactMethod] = useState<ContactMethod>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `phone` state holds the 10-digit local number ONLY ("4035550100").
  // The country code "+1" is rendered as a fixed prefix by <PhoneInput />
  // and re-attached via toE164() at submit time.
  const contactReady = contactMethod === 'email' ? email.includes('@') : isPhoneComplete(phone);
  const canSubmit = name.trim().length > 1 && contactReady && password.length >= 10 && acceptTerms;

  const toast = useToast();
  const google = useGoogleSignIn();

  // OAuth — customer-only. Partners use the partner-signin code flow.
  const onApple = async () => {
    const res = await signInWithApple();
    if (!res.ok) {
      toast.error(res.error ?? 'Apple sign-in failed.');
      return;
    }
    router.replace('/(customer)/home');
  };
  const onGoogle = async () => {
    const res = await google.signIn();
    if (!res.ok) {
      toast.error(res.error ?? 'Google sign-in failed.');
      return;
    }
    router.replace('/(customer)/home');
  };

  const submit = async () => {
    if (!supabaseConfigured) {
      Alert.alert('Backend not configured', 'Supabase keys are missing. Add them to .env.local.');
      return;
    }
    setError(null);
    setLoading(true);

    const phoneE164 = phone ? toE164(phone) : '';
    const meta = {
      full_name: name,
      role: 'customer',
      // Always store both fields in metadata if provided, even if only one is the "verified" one
      ...(email ? { email_pref: email } : {}),
      ...(phoneE164 ? { phone: phoneE164 } : {}),
      // Terms acceptance — recorded server-side via handle_new_user so we
      // can re-prompt if the version bumps (Section 14 of the Terms).
      terms_accepted_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
    };

    // try/finally so the button always comes back to life — without this
    // a thrown supabase error left it stuck in the spinner state.
    try {
      let authError;
      if (contactMethod === 'email') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: meta },
        });
        authError = error;
      } else {
        const { error } = await supabase.auth.signUp({
          phone: phoneE164,
          password,
          options: { data: meta },
        });
        authError = error;
      }

      if (authError) {
        const msg = authError.message;
        if (msg.toLowerCase().includes('phone') && msg.toLowerCase().includes('disabled')) {
          setError('Phone signup needs Twilio configured in Supabase Auth. Use email for now.');
        } else if (msg.toLowerCase().includes('already')) {
          setError('An account with that email/phone already exists.');
        } else {
          setError(msg);
        }
        return;
      }

      Alert.alert(
        contactMethod === 'email' ? 'Check your email' : 'Check your SMS',
        contactMethod === 'email'
          ? 'We sent you a verification link. Tap it, then come back and sign in.'
          : 'We sent a 6-digit code via SMS. Enter it on the next screen.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not create your account. Check your connection and try again.');
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
            <Text className="text-3xl font-bold text-ink-900 leading-9">
              Moving Made Easy,{'\n'}One Click at a Time.
            </Text>
            <Text className="mt-3 text-base text-silver-500">
              Sign up with email or phone — whichever you prefer.
            </Text>

            {/* Contact method toggle */}
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
              <Input
                label="Full name"
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
              />

              {contactMethod === 'email' ? (
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  hint="We'll send a verification link"
                  leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
                />
              ) : (
                <PhoneInput
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  hint="We'll text you a 6-digit code · Canada & US only for now"
                />
              )}

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
                  // Stop propagation so tapping the link doesn't also
                  // toggle the checkbox underneath.
                  onPress={(e) => e.stopPropagation()}
                >
                  Terms of Service
                </Link>
                {' '}and{' '}
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

            <View className="mt-6">
              <Button
                label="Create account"
                size="lg"
                fullWidth
                loading={loading}
                disabled={!canSubmit}
                onPress={submit}
              />
            </View>

            {/* OAuth — customer-only sign-up. iOS gets both buttons,
                Android hides Apple (iOS-only by Apple's rules). */}
            <View className="my-6 flex-row items-center">
              <View className="h-px flex-1 bg-silver-200" />
              <Text className="mx-3 text-xs uppercase text-silver-400">or sign up with</Text>
              <View className="h-px flex-1 bg-silver-200" />
            </View>

            <View className="flex-row gap-3">
              {Platform.OS === 'ios' ? (
                <Pressable
                  onPress={onApple}
                  className="h-12 flex-1 flex-row items-center justify-center rounded-2xl border border-silver-300 bg-white active:opacity-70"
                >
                  <Ionicons name="logo-apple" size={20} color="#0A0A0A" />
                  <Text className="ml-2 text-sm font-semibold text-ink-900">Apple</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onGoogle}
                className="h-12 flex-1 flex-row items-center justify-center rounded-2xl border border-silver-300 bg-white active:opacity-70"
              >
                <Ionicons name="logo-google" size={20} color="#0A0A0A" />
                <Text className="ml-2 text-sm font-semibold text-ink-900">Google</Text>
              </Pressable>
            </View>

            <View className="mt-6 mb-4 flex-row items-center justify-center">
              <Text className="text-sm text-silver-500">Already have an account? </Text>
              <Link href="/(auth)/login" className="text-sm font-semibold text-brand-700">
                Sign in
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
