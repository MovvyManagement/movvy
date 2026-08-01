// =============================================================================
// /(auth)/partner-join  —  Option C: open code + owner approval
//
// Drivers / movers / dispatchers come here from the welcome screen ("Got an
// invite from your team? Join here") or via a deep link like
// movvy://join/CO-X7QJ4M.
//
// They provide:
//   • the team / company invite code (auto-filled from deep link)
//   • their own email OR phone (used to set up their account — it does NOT
//     have to match anything the owner entered)
//   • a chosen password + their full name
//
// We call partners-invite-accept, which creates the auth user and inserts a
// membership row in status='pending_approval'. The team operator / company
// owner then approves (or rejects) the request from their crew screen. The
// applicant can sign in immediately, but lands on the waiting-for-approval
// screen until they're approved. No session is returned here (the edge fn
// uses an admin client), so we send them to partner-signin next.
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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhoneInput, isPhoneComplete, toE164 } from '@/components/PhoneInput';
import { useAcceptPartnerInvite } from '@/lib/data';
import { supabaseConfigured } from '@/lib/supabase';

type ContactMethod = 'email' | 'phone';

export default function PartnerJoin() {
  const { code: codeFromUrl } = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState((codeFromUrl ?? '').toUpperCase());
  const [contactMethod, setContactMethod] = useState<ContactMethod>('phone');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useAcceptPartnerInvite();

  // Format check is enforced server-side; keep the client check loose so
  // typos turn into helpful "code not found" errors rather than disabled buttons.
  const codeShape = /^(TM|CO)-[A-Z0-9]{6}$/.test(code.trim().toUpperCase());
  const contactReady =
    contactMethod === 'email' ? email.includes('@') : isPhoneComplete(phone);
  const canSubmit =
    codeShape && name.trim().length > 1 && contactReady && password.length >= 10;

  const submit = async () => {
    if (!supabaseConfigured) {
      Alert.alert(
        'Backend not configured',
        'Connect Supabase in .env.local to test the invite-accept flow.',
      );
      return;
    }
    setError(null);
    try {
      const res = await accept.mutateAsync({
        invite_code: code.trim().toUpperCase(),
        full_name: name.trim(),
        password,
        ...(contactMethod === 'email'
          ? { email: email.trim().toLowerCase() }
          : { phone: toE164(phone) }),
      });
      // Option C: partners-invite-accept created (or found) the membership in
      // pending_approval. It uses an admin client, so there's no session to
      // hand back — the applicant signs in next, which routes them to the
      // waiting screen (pending) or straight to the dashboard (already
      // active). res.message carries the right server-authored copy.
      const title = res.already_member
        ? "You're already on the roster"
        : 'Request sent';
      Alert.alert(
        title,
        res.message,
        [{ text: 'Sign in', onPress: () => router.replace('/(auth)/partner-signin') }],
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not accept invite.');
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
            <Text className="text-3xl font-bold text-ink-900">Join your crew</Text>
            <Text className="mt-2 text-base text-silver-500">
              Enter your team or company's invite code to request to join. The
              owner reviews and approves new members before you start seeing
              jobs.
            </Text>

            {/* Invite code */}
            <View className="mt-6">
              <Input
                label="Team / company code"
                placeholder="TM-XXXXXX or CO-XXXXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                hint="Shared by your team owner or company"
                leftIcon={<Ionicons name="key-outline" size={18} color="#71717A" />}
              />
            </View>

            {/* Contact toggle */}
            <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              Your contact details
            </Text>
            <View className="flex-row rounded-2xl bg-silver-100 p-1">
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
                  hint="We'll use this to set up your account"
                  leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
                />
              ) : (
                <PhoneInput
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  hint="We'll use this to set up your account"
                />
              )}

              <Input
                label="Full legal name"
                placeholder="Your name"
                autoCapitalize="words"
                autoComplete="name"
                value={name}
                onChangeText={setName}
                leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
              />

              <Input
                label="Choose a password"
                placeholder="At least 10 characters · upper, lower, number"
                secureTextEntry={!showPw}
                autoComplete="new-password"
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
                label="Request to join"
                size="lg"
                fullWidth
                loading={accept.isPending}
                disabled={!canSubmit}
                onPress={submit}
              />
            </View>

            <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row">
              <Ionicons name="shield-checkmark-outline" size={18} color="#71717A" />
              <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
                The code lets you request to join. The team owner reviews and
                approves every new member before they can see jobs — so no one
                gets on the roster without their say-so.
              </Text>
            </View>

            <View className="mt-6 mb-4 items-center">
              <Text className="text-sm text-silver-500">Already joined?</Text>
              <Pressable
                // Crew sign in through the PARTNER sign-in (code + password), not
                // the customer login. This link used to drop them on the customer
                // screen, which was a dead end for a driver.
                onPress={() => router.replace('/(auth)/partner-signin')}
                className="mt-1"
              >
                <Text className="text-sm font-semibold text-brand-700">
                  Sign in with your team code
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
