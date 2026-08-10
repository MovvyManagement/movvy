// =============================================================================
// /(auth)/forgot-password — reset by CODE, in three steps.
//
//   1. Enter the email or phone on the account  → we send a 6-digit code
//   2. Type the code                            → verifying it signs you in
//   3. Choose a new password                    → saved, and you're in the app
//
// Replaces a link-based reset that pointed at movvy://reset-password — a route
// that never existed, so anyone who forgot their password had no way back in.
// A code also works over SMS, which a link can't do well, and survives the mail
// app opening its own in-app browser.
//
// Used by BOTH sides. `?side=partner` (from the partner sign-in) lands them on
// the partner dashboard afterwards instead of the customer home.
//
// We never say whether a contact is registered: the "code sent" screen shows
// for anything, so this can't be used to test which emails have accounts.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import {
  accountSides,
  myPartnerSurface,
  retryAfterSeconds,
  sendPasswordResetCode,
  setNewPassword,
  logout,
  supabaseConfigured,
  verifyPasswordResetCode,
} from '@/lib/supabase';
import { haptic } from '@/lib/haptics';

type Method = 'email' | 'phone';
type Step = 'contact' | 'code' | 'password';

// Ceiling for our own countdown. GoTrue enforces its own window server-side
// and we now read that number off the 429 (retryAfterSeconds), so this is only
// the starting guess — it used to be 45s while the server refused for longer,
// which meant the button went live before the server would answer.
const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPassword() {
  const { side } = useLocalSearchParams<{ side?: string }>();
  const isPartner = side === 'partner';

  const [step, setStep] = useState<Step>('contact');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // The contact we actually sent to — frozen when the code goes out, so editing
  // the field afterwards can't desync the verify call from the send.
  const sentTo = useRef<{ email?: string; phone?: string }>({});

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const contactReady =
    method === 'email' ? email.includes('@') && email.length > 4 : isPhoneComplete(phone);

  const sendCode = async () => {
    if (!supabaseConfigured || !contactReady || loading) return;
    setError(null);
    setLoading(true);
    try {
      const contact =
        method === 'email'
          ? { email: email.trim().toLowerCase() }
          : { phone: toE164(phone) };
      const res = await sendPasswordResetCode(contact);
      if (!res.ok) {
        setError(res.error ?? "Couldn't send the code.");
        // If the server told us how long it wants, run the countdown off THAT
        // rather than our own guess, so the button can't unlock early again.
        const wait = retryAfterSeconds(res.error);
        if (wait != null) setResendIn(wait);
        return;
      }
      sentTo.current = contact;
      haptic.success();
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setStep('code');
    } catch (e: any) {
      setError(e?.message ?? "Couldn't send the code. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.replace(/\D/g, '').length < 6 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await verifyPasswordResetCode(sentTo.current, code);
      if (!res.ok) {
        haptic.error();
        setError(res.error ?? "That code didn't work.");
        return;
      }
      haptic.success();
      setStep('password');
    } catch (e: any) {
      setError(e?.message ?? 'Could not check that code.');
    } finally {
      setLoading(false);
    }
  };

  const savePassword = async () => {
    if (loading) return;
    setError(null);
    if (pw1.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setError("Those two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await setNewPassword(pw1);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that password.");
        return;
      }
      // ─── The reset must not be a way around the door check ────────────────
      // Verifying the code creates a real session, so without this a
      // partner-only account could reset its password on the customer screen
      // and walk straight into the customer app — and a customer-only account
      // could do the reverse with ?side=partner and get pushed into partner
      // onboarding. login() and loginPartner() both gate on registered sides;
      // this path was the one hole in that.
      const sides = await accountSides();
      const allowed = isPartner ? sides.partner : sides.customer;
      if (!allowed) {
        await logout();
        setError(
          isPartner
            ? "Password updated — but this login isn't registered as a partner. Tap 'Create your account' on the partner sign-in to register, then sign in."
            : "Password updated — but this login isn't registered as a customer. Create a customer account to book a move; you can reuse this email.",
        );
        return;
      }

      haptic.success();
      // Land them on the surface they're actually registered for. Crew must not
      // be dropped on the admin dashboard — that's where pricing and dispatch
      // live, and partner-signin is careful to route crew to (mover).
      if (!isPartner) {
        router.replace('/(customer)/(tabs)/home');
        return;
      }
      const membership = await myPartnerSurface();
      router.replace(
        membership === 'admin'
          ? '/(company)/(tabs)/dashboard'
          : '/(mover)/(tabs)/dashboard',
      );
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save that password.");
    } finally {
      setLoading(false);
    }
  };

  const sentLabel = sentTo.current.email ?? sentTo.current.phone ?? 'you';

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
            {/* ── Step 1 · where to send it ───────────────────────────────── */}
            {step === 'contact' ? (
              <>
                <Text className="text-3xl font-bold text-ink-900">Reset password</Text>
                <Text className="mt-2 text-base text-silver-500 leading-6">
                  We'll send a 6-digit code to the email or phone on your account.
                </Text>

                <View className="mt-6 flex-row rounded-2xl bg-silver-100 p-1">
                  {(['email', 'phone'] as Method[]).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        setMethod(m);
                        setError(null);
                      }}
                      className={`flex-1 rounded-xl py-2.5 items-center ${
                        method === m ? 'bg-white' : ''
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          method === m ? 'text-ink-900' : 'text-silver-500'
                        }`}
                      >
                        {m === 'email' ? 'Email' : 'Phone'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View className="mt-6">
                  {method === 'email' ? (
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
                    <PhoneInput label="Phone" value={phone} onChangeText={setPhone} />
                  )}
                </View>

                <View className="mt-6">
                  <Button
                    label="Send code"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={!contactReady}
                    onPress={sendCode}
                  />
                </View>
              </>
            ) : null}

            {/* ── Step 2 · the code ───────────────────────────────────────── */}
            {step === 'code' ? (
              <>
                <Text className="text-3xl font-bold text-ink-900">Enter the code</Text>
                <Text className="mt-2 text-base text-silver-500 leading-6">
                  We sent a 6-digit code to{' '}
                  <Text className="font-semibold text-ink-900">{sentLabel}</Text>. It
                  expires in a few minutes.
                </Text>

                <View className="mt-6">
                  <Input
                    label="6-digit code"
                    placeholder="123456"
                    keyboardType="number-pad"
                    maxLength={6}
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                    leftIcon={<Ionicons name="keypad-outline" size={18} color="#71717A" />}
                  />
                </View>

                <View className="mt-6">
                  <Button
                    label="Verify code"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={code.length < 6}
                    onPress={verifyCode}
                  />
                </View>

                <Pressable
                  onPress={resendIn > 0 ? undefined : sendCode}
                  disabled={resendIn > 0 || loading}
                  className="mt-4 items-center"
                >
                  <Text
                    className={`text-sm font-semibold ${
                      resendIn > 0 ? 'text-silver-400' : 'text-brand-700'
                    }`}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setStep('contact');
                    setCode('');
                    setError(null);
                  }}
                  className="mt-3 items-center"
                >
                  <Text className="text-sm text-silver-500">
                    Use a different {method === 'email' ? 'email' : 'number'}
                  </Text>
                </Pressable>
              </>
            ) : null}

            {/* ── Step 3 · the new password ───────────────────────────────── */}
            {step === 'password' ? (
              <>
                <Text className="text-3xl font-bold text-ink-900">
                  Choose a new password
                </Text>
                <Text className="mt-2 text-base text-silver-500 leading-6">
                  At least 8 characters. You'll be signed in as soon as you save.
                </Text>

                <View className="mt-6 gap-3">
                  <Input
                    label="New password"
                    placeholder="••••••••"
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    value={pw1}
                    onChangeText={setPw1}
                    leftIcon={
                      <Ionicons name="lock-closed-outline" size={18} color="#71717A" />
                    }
                    rightIcon={
                      <Pressable onPress={() => setShowPw((v) => !v)}>
                        <Ionicons
                          name={showPw ? 'eye-off-outline' : 'eye-outline'}
                          size={18}
                          color="#71717A"
                        />
                      </Pressable>
                    }
                  />
                  <Input
                    label="Confirm password"
                    placeholder="••••••••"
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    value={pw2}
                    onChangeText={setPw2}
                    leftIcon={
                      <Ionicons name="lock-closed-outline" size={18} color="#71717A" />
                    }
                  />
                </View>

                <View className="mt-6">
                  <Button
                    label="Save password"
                    size="lg"
                    fullWidth
                    loading={loading}
                    disabled={pw1.length < 8 || pw2.length < 8}
                    onPress={savePassword}
                  />
                </View>
              </>
            ) : null}

            {error ? (
              <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
                <Ionicons name="alert-circle" size={18} color="#EF4444" />
                <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
