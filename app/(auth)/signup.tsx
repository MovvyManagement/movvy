// =============================================================================
// Customer signup — email + phone, both required, SMS OTP verifies the phone.
//
// Two-step UX:
//   1. Form: name, email, phone, password, terms
//   2. SMS OTP: 6-digit code Supabase Auth texts to the phone
//
// We sign up phone-first (Supabase Auth supports phone + password) so the
// OTP verification creates a real session. Then we attach the email via
// auth.updateUser({ email }) — Supabase fires the confirmation email in the
// background, but the customer is already signed in and can book / receive
// calls immediately.
//
// Why both: the phone-proxy call feature only works when both customer + driver
// have a verified E.164 phone on file. Email-only signups blocked calling for
// ~30% of customers in early beta. Now every customer is callable from day 1.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
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
import { haptic } from '@/lib/haptics';

type Step = 'form' | 'otp';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 30;

export default function Signup() {
  const toast = useToast();
  const google = useGoogleSignIn();

  // ─── Form state (Step 1) ─────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  // ─── OTP state (Step 2) ──────────────────────────────────────────────────
  const [otp, setOtp] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // ─── Network state ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-field errors — set when the user taps "Send Verification Code" with
  // anything missing or malformed. Previously the button just stayed greyed
  // out with no explanation, which led to "I filled everything in, why
  // doesn't it work?" confusion (the password field looks identical empty
  // vs filled because of secureTextEntry).
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    phone?: string;
    password?: string;
    terms?: string;
  }>({});

  // E.164 derived once so we don't repeat the toE164 call.
  const phoneE164 = phone ? toE164(phone) : '';

  const canSubmitOtp = otp.replace(/\D/g, '').length === 6 && !loading;

  // Validate every field and return inline error messages. We surface these
  // beside each input instead of silently disabling the button.
  function validateForm(): { ok: boolean; errors: typeof fieldErrors } {
    const errs: typeof fieldErrors = {};
    if (name.trim().length < 2) errs.name = 'Enter your full name.';
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!isPhoneComplete(phone)) errs.phone = 'Enter your 10-digit phone number.';
    if (password.length < 10) errs.password = 'Password must be at least 10 characters.';
    if (!acceptTerms) errs.terms = 'Tap the checkbox to accept Movvy\'s Terms.';
    return { ok: Object.keys(errs).length === 0, errors: errs };
  }

  // Resend cooldown timer — gives the customer 30s before they can ask for
  // another code so we don't spam Twilio (or them) with re-sends.
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

  // ─── OAuth (unchanged — customer-only) ──────────────────────────────────
  const onApple = async () => {
    const res = await signInWithApple();
    if (!res.ok) return toast.error(res.error ?? 'Apple sign-in failed.');
    router.replace('/(customer)/(tabs)/home');
  };
  const onGoogle = async () => {
    const res = await google.signIn();
    if (!res.ok) return toast.error(res.error ?? 'Google sign-in failed.');
    router.replace('/(customer)/(tabs)/home');
  };

  // ─── Step 1 → Step 2: create the pending auth user + send SMS OTP ───────
  const submitForm = async () => {
    if (!supabaseConfigured) {
      Alert.alert('Backend not configured', 'Supabase keys are missing. Add them to .env.local.');
      return;
    }

    // Run client-side validation FIRST so any incomplete field gets a
    // visible message right next to it. If the validator fails, we don't
    // call Supabase / Twilio — that would have wasted an SMS credit and
    // given a vague generic error.
    const v = validateForm();
    setFieldErrors(v.errors);
    if (!v.ok) {
      haptic.error();
      // Top-level error is the FIRST failing field — keeps the banner short.
      const firstMsg =
        v.errors.name ??
        v.errors.email ??
        v.errors.phone ??
        v.errors.password ??
        v.errors.terms ??
        null;
      setError(firstMsg);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      // Phone-first signup. Email goes into metadata so the handle_new_user
      // trigger writes profiles.email when the OTP verification finally
      // creates the auth.users row. We also re-attach the email via
      // updateUser after OTP so Supabase tracks it for password resets.
      const meta = {
        full_name: name.trim(),
        role: 'customer',
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
            'Phone signup needs to be enabled in your Supabase Auth dashboard: ' +
              'Authentication → Providers → Phone → toggle ON, choose Twilio, paste your secrets.',
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

  // ─── Step 2: verify OTP → attach email → enter the app ─────────────────
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

      // Phone verified, session active. Now attach the email so Supabase
      // owns both contact methods. Supabase fires a confirmation email
      // in the background — the customer doesn't need to click it before
      // booking (phone is already the verified primary identity).
      const cleanEmail = email.trim().toLowerCase();
      try {
        await supabase.auth.updateUser({ email: cleanEmail });
      } catch (eu) {
        // Non-fatal: the customer can re-attempt email from Profile → Email.
        console.warn('[signup] email attach failed, continuing', eu);
      }
      // Belt-and-suspenders — write the email to the profile row directly
      // so it's immediately visible across the app (receipts header,
      // greeting, support hub). handle_new_user inserted from auth.users
      // where email was null at INSERT time, so the column is empty until
      // we backfill it here. RLS lets the signed-in user update their own
      // row.
      try {
        const { data: u } = await supabase.auth.getUser();
        if (u?.user?.id) {
          await supabase
            .from('profiles')
            .update({ email: cleanEmail })
            .eq('id', u.user.id);
        }
      } catch (epu) {
        console.warn('[signup] profile email backfill failed, continuing', epu);
      }

      haptic.success();
      toast.success('Welcome to Movvy!');
      router.replace('/(customer)/(tabs)/home');
    } catch (e: any) {
      setError(e?.message ?? "Couldn't verify the code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Resend the OTP ──────────────────────────────────────────────────────
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
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScreenHeader />
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6">
            {step === 'form' ? renderForm() : renderOtp()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  // ─── Step 1: the form ───────────────────────────────────────────────────
  function renderForm() {
    return (
      <>
        <Text className="text-3xl font-bold text-ink-900 leading-9">
          Moving Made Easy,{'\n'}One Click at a Time.
        </Text>
        <Text className="mt-3 text-base text-silver-500">
          Email + phone, so your crew can reach you and we can text status
          updates. Both are required.
        </Text>

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
            hint={fieldErrors.email ? undefined : "We'll email your booking receipts here."}
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
            hint={fieldErrors.phone ? undefined : "We'll text a 6-digit code to verify · Canada & US only."}
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
            . I consent to receive SMS messages from Movvy at the phone number
            I provided.
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

        <View className="mt-6">
          <Button
            label="Send Verification Code"
            size="lg"
            fullWidth
            loading={loading}
            // Intentionally NOT disabled when fields are incomplete — tapping
            // now runs validation and lights up the exact missing field
            // instead of failing silently.
            onPress={submitForm}
          />
        </View>

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

        {/* OAuth note — when Apple/Google sign-in is used, we still need a
            phone before the customer can book. The first-launch gate handles
            collection via Profile → Phone. */}
        <Text className="mt-3 text-[11px] text-silver-400 leading-4">
          Apple / Google sign-in skips the form, but we'll still ask for your
          phone before your first booking.
        </Text>

        <View className="mt-6 mb-4 flex-row items-center justify-center">
          <Text className="text-sm text-silver-500">Already have an account? </Text>
          <Link href="/(auth)/login" className="text-sm font-semibold text-brand-700">
            Sign in
          </Link>
        </View>
      </>
    );
  }

  // ─── Step 2: the OTP code ───────────────────────────────────────────────
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
          to finish creating your account.
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

        <View className="mt-6">
          <Button
            label="Verify & Create Account"
            size="lg"
            fullWidth
            loading={loading}
            disabled={!canSubmitOtp}
            onPress={submitOtp}
          />
        </View>

        <Pressable
          onPress={resendOtp}
          disabled={resendIn > 0 || loading}
          className="mt-3 h-12 items-center justify-center"
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

        <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row">
          <Ionicons name="shield-checkmark-outline" size={18} color="#047857" />
          <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-5">
            Your phone is verified at signup so your crew can reach you the
            moment they're on the way. Movvy never shares your real number —
            calls are routed through a private proxy line.
          </Text>
        </View>
      </>
    );
  }
}
