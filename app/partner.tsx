// =============================================================================
// Partner signup — single sign-up form for solo crews AND moving companies.
// Phone-first signup with SMS OTP, same pattern as the customer signup.
//
// Step 1 of 5 in the partner onboarding journey:
//   1. Account (this screen — form, then SMS OTP)
//   2. Either:
//        Solo crew  → /(mover)/onboarding/personal
//        Company    → /(company)/onboarding/company-info
//   3-5. Vehicle/Drivers → Documents → Pending review
//
// Same UX choices as the customer signup:
//   • Both email + phone required (phone OTP-verified so the proxy
//     call/SMS line can route to the partner from day 1)
//   • Per-field validation on Continue tap — button never silently disables
//   • Phone-first signUp, then auth.updateUser({ email }) after OTP
//     to attach the email + trigger confirmation email in the background
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { Button } from '@/components/Button';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { TERMS_VERSION } from '@/lib/brand';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

type PartnerKind = 'solo' | 'company';
type Step = 'form' | 'otp';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 30;

export default function PartnerSignup() {
  const toast = useToast();

  // ─── State ────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('form');
  const [kind, setKind] = useState<PartnerKind>('solo');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [otp, setOtp] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-field error map — surfaces inline messages on Continue tap.
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    phone?: string;
    password?: string;
    terms?: string;
  }>({});

  const phoneE164 = phone ? toE164(phone) : '';
  const canSubmitOtp = otp.replace(/\D/g, '').length === 6 && !loading;

  // Validate every field and return inline errors per field.
  function validateForm(): { ok: boolean; errors: typeof fieldErrors } {
    const errs: typeof fieldErrors = {};
    if (name.trim().length < 2) errs.name = 'Enter your full name.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!isPhoneComplete(phone)) errs.phone = 'Enter your 10-digit phone number.';
    if (password.length < 10) errs.password = 'Password must be at least 10 characters.';
    if (!acceptTerms) errs.terms = "Tap the checkbox to accept Movvy's terms.";
    return { ok: Object.keys(errs).length === 0, errors: errs };
  }

  // Resend cooldown timer
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (resendIn <= 0) return;
    cooldownRef.current = setInterval(() => {
      setResendIn((n) => Math.max(0, n - 1));
    }, 1000);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [resendIn]);

  const continueOnboarding = () => {
    if (kind === 'solo') router.replace('/(mover)/onboarding/personal');
    else router.replace('/(company)/onboarding/company-info');
  };

  // ─── Step 1 → Step 2: signUp with phone + send SMS OTP ───────────────────
  const submitForm = async () => {
    if (!supabaseConfigured) {
      // Demo path — skip auth, go straight to onboarding.
      continueOnboarding();
      return;
    }

    const v = validateForm();
    setFieldErrors(v.errors);
    if (!v.ok) {
      haptic.error();
      setError(
        v.errors.name ??
          v.errors.email ??
          v.errors.phone ??
          v.errors.password ??
          v.errors.terms ??
          null,
      );
      return;
    }

    setError(null);
    setLoading(true);
    try {
      // Role is encoded in metadata so handle_new_user writes the right
      // partner role to profiles.
      const role = kind === 'solo' ? 'driver' : 'company_owner';
      const meta = {
        full_name: name.trim(),
        role,
        email: email.trim().toLowerCase(),
        phone: phoneE164,
        terms_accepted_version: TERMS_VERSION,
        terms_accepted_at: new Date().toISOString(),
      };
      const { error: signupErr } = await supabase.auth.signUp({
        phone: phoneE164,
        password,
        options: { data: meta },
      });
      if (signupErr) {
        const msg = signupErr.message.toLowerCase();
        if (msg.includes('already') || msg.includes('registered')) {
          setError("That phone number is already on a Movvy account. Try signing in instead.");
        } else if (msg.includes('phone provider') || msg.includes('sms') || msg.includes('disabled')) {
          setError(
            'Phone signup needs Supabase Auth → Providers → Phone toggled ON with Twilio creds.',
          );
        } else {
          setError(signupErr.message);
        }
        return;
      }
      haptic.success();
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setStep('otp');
    } catch (e: any) {
      setError(e?.message ?? "Couldn't start signup. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2: verify OTP → attach email → continue onboarding ─────────────
  const submitOtp = async () => {
    if (!canSubmitOtp) return;
    setError(null);
    setLoading(true);
    try {
      const token = otp.replace(/\D/g, '');
      const { error: vErr } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token,
        type: 'sms',
      });
      if (vErr) {
        if (vErr.message.toLowerCase().includes('expired')) {
          setError("That code expired. Tap Resend to get a new one.");
        } else {
          setError("That code didn't match. Check your messages and try again.");
        }
        return;
      }

      // Attach email so the partner can recover via email later. Profile
      // backfilled directly so the rest of the app sees it immediately.
      const cleanEmail = email.trim().toLowerCase();
      try {
        await supabase.auth.updateUser({ email: cleanEmail });
      } catch (eu) {
        console.warn('[partner signup] email attach failed, continuing', eu);
      }
      try {
        const { data: u } = await supabase.auth.getUser();
        if (u?.user?.id) {
          await supabase
            .from('profiles')
            .update({ email: cleanEmail })
            .eq('id', u.user.id);
        }
      } catch (epu) {
        console.warn('[partner signup] profile email backfill failed', epu);
      }

      haptic.success();
      toast.success('Account verified — let\'s finish your partner profile.');
      continueOnboarding();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't verify the code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const { error: rErr } = await supabase.auth.resend({
        type: 'sms',
        phone: phoneE164,
      });
      if (rErr) {
        setError(rErr.message);
        return;
      }
      haptic.light();
      toast.success(`New code sent to ${phoneE164}`);
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't resend the code.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

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
            {step === 'form' ? renderForm() : renderOtp()}
          </ScrollView>

          <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
            {step === 'form' ? (
              <Button
                label="Continue"
                size="lg"
                fullWidth
                loading={loading}
                onPress={submitForm}
              />
            ) : (
              <Button
                label="Verify & Continue"
                size="lg"
                fullWidth
                loading={loading}
                disabled={!canSubmitOtp}
                onPress={submitOtp}
              />
            )}
            {step === 'form' ? (
              <View className="mt-3 flex-row items-center justify-center">
                <Text className="text-xs text-silver-500">Already a partner? </Text>
                <Link
                  href="/(auth)/partner-signin"
                  className="text-xs font-semibold text-brand-700"
                >
                  Sign in with team code →
                </Link>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );

  // ─── Step 1: kind picker + form ─────────────────────────────────────────
  function renderForm() {
    return (
      <>
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
            Same account whether you're a 2-person crew or a fleet operator.
            Pick which one you are and we'll tailor the rest.
          </Text>
        </View>

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
            <Ionicons name="people" size={22} color={kind === 'solo' ? '#047857' : '#0A0A0A'} />
            <Text className="mt-2 text-base font-bold text-ink-900">Solo crew</Text>
            <Text className="text-xs text-silver-500 mt-1">2-person team · 1 driver + 1 mover</Text>
          </Pressable>
          <Pressable
            onPress={() => setKind('company')}
            className={`flex-1 rounded-3xl border p-4 ${
              kind === 'company' ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
            }`}
          >
            <Ionicons name="business" size={22} color={kind === 'company' ? '#047857' : '#0A0A0A'} />
            <Text className="mt-2 text-base font-bold text-ink-900">Moving company</Text>
            <Text className="text-xs text-silver-500 mt-1">Fleet · multiple drivers</Text>
          </Pressable>
        </View>

        <View className="mt-6 gap-4">
          <Input
            label="Full name"
            placeholder="Your name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
            }}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
            error={fieldErrors.name}
          />
          <Input
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
            }}
            leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
            error={fieldErrors.email}
          />
          <PhoneInput
            label="Phone"
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              if (fieldErrors.phone) setFieldErrors((p) => ({ ...p, phone: undefined }));
            }}
            hint={
              fieldErrors.phone
                ? undefined
                : 'Used for proxy calls/SMS with customers · verified via OTP next'
            }
            error={fieldErrors.phone}
          />
          <Input
            label="Password"
            placeholder="At least 10 characters"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
            }}
            leftIcon={<Ionicons name="lock-closed-outline" size={18} color="#71717A" />}
            error={fieldErrors.password}
            hint={fieldErrors.password ? undefined : `${password.length} / 10 characters`}
          />
        </View>

        <Pressable
          onPress={() => {
            setAcceptTerms((v) => !v);
            if (fieldErrors.terms) setFieldErrors((p) => ({ ...p, terms: undefined }));
          }}
          className={`mt-5 flex-row items-start rounded-2xl p-2 -mx-2 active:opacity-70 ${
            fieldErrors.terms ? 'bg-red-50' : ''
          }`}
        >
          <View
            className={`mt-0.5 mr-3 h-5 w-5 rounded border-2 items-center justify-center ${
              acceptTerms
                ? 'border-brand-600 bg-brand-600'
                : fieldErrors.terms
                ? 'border-danger bg-white'
                : 'border-silver-300 bg-white'
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
        {fieldErrors.terms ? (
          <Text className="mt-1 text-xs text-danger" accessibilityRole="alert">
            {fieldErrors.terms}
          </Text>
        ) : null}

        {error ? (
          <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
          </View>
        ) : null}

        <View className="my-4 rounded-2xl bg-silver-50 p-4">
          <Text className="text-[11px] text-silver-500 leading-5">
            After you verify your phone we'll guide you through{' '}
            {kind === 'solo'
              ? 'team setup, vehicle, and document verification'
              : 'company info, driver roster, and document verification'}
            . Approval usually within 24–48 hours.
          </Text>
        </View>
      </>
    );
  }

  // ─── Step 2: SMS OTP ────────────────────────────────────────────────────
  function renderOtp() {
    return (
      <>
        <Pressable
          onPress={() => {
            setStep('form');
            setOtp('');
            setError(null);
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to signup form"
          hitSlop={6}
          className="self-start h-10 w-10 rounded-full bg-silver-100 items-center justify-center mt-2"
        >
          <Ionicons name="chevron-back" size={20} color="#0A0A0A" />
        </Pressable>

        <Text className="mt-4 text-3xl font-bold text-ink-900 leading-9">
          Check Your Messages.
        </Text>
        <Text className="mt-3 text-base text-silver-500 leading-6">
          We sent a 6-digit code to{' '}
          <Text className="font-bold text-ink-900">{phoneE164}</Text>. Enter it
          to finish creating your partner account.
        </Text>

        <View className="mt-7">
          <Input
            label="6-Digit Code"
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            leftIcon={<Ionicons name="keypad-outline" size={18} color="#71717A" />}
          />
        </View>

        {error ? (
          <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={resendOtp}
          disabled={resendIn > 0 || loading}
          className="mt-4 h-12 items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel="Resend the verification code"
        >
          <Text
            className={`text-sm font-semibold ${
              resendIn > 0 ? 'text-silver-400' : 'text-brand-700'
            }`}
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
          </Text>
        </Pressable>

        <View className="mt-4 rounded-2xl bg-silver-50 p-4 flex-row">
          <Ionicons name="shield-checkmark-outline" size={18} color="#047857" />
          <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-5">
            Phone verification is mandatory for partners so customers can reach
            you on a Movvy proxy line without ever seeing your real number.
          </Text>
        </View>
      </>
    );
  }
}
