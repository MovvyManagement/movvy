// =============================================================================
// /(auth)/partner-join
//
// Invited drivers / movers / dispatchers come here from the welcome screen
// ("Got an invite from your team? Join here") or directly via a deep link
// like movvy://join/CO-X7QJ4M.
//
// They provide:
//   • the team / company invite code (auto-filled from deep link)
//   • the email OR phone the owner registered them with
//   • a chosen password + their full name
//
// We call partners-invite-accept which validates the (code, contact) pair
// against partner_invites, creates the auth user, and links them to the
// team / company in one transaction. After success, we drop them on the
// login screen so they can sign in.
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
      // After account creation we DON'T auto-link to the team/company.
      // The driver signs in next, lands on /(mover)/jobs (or company
      // dashboard), and InviteAcceptHost pops the explicit Accept /
      // Decline modal against the invite that's still pending.
      Alert.alert(
        res.created_new ? 'Account created' : 'Linked to your account',
        `${res.message} You'll get an invite popup once you're signed in.`,
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
              Enter the code from the text or email you received. We use it to
              link you to your company or team.
            </Text>

            {/* Invite code */}
            <View className="mt-6">
              <Input
                label="Team invite code"
                placeholder="TM-XXXXXX or CO-XXXXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                hint="From the text/email your team owner sent"
                leftIcon={<Ionicons name="key-outline" size={18} color="#71717A" />}
              />
            </View>

            {/* Contact toggle */}
            <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              How were you added?
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
                  hint="Must match the email your team owner added"
                  leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
                />
              ) : (
                <PhoneInput
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  hint="Must match the phone your team owner added"
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
                label="Join my team"
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
                Your team's invite code only works if the email/phone you enter
                here matches what the team owner added you with. Both must
                match — no one can sneak in.
              </Text>
            </View>

            <View className="mt-6 mb-4 items-center">
              <Text className="text-sm text-silver-500">Already joined?</Text>
              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                className="mt-1"
              >
                <Text className="text-sm font-semibold text-brand-700">
                  Sign in with your account
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
