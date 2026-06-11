import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { resetPassword } from '@/lib/supabase';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (sent) {
      router.replace('/(auth)/login');
      return;
    }
    setError(null);
    setLoading(true);
    const res = await resetPassword({ email });
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not send reset email.');
      return;
    }
    setSent(true);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <View className="flex-1 px-6">
        <Text className="text-3xl font-bold text-ink-900">Reset password</Text>
        <Text className="mt-2 text-base text-silver-500">
          We'll email you a secure reset link.
        </Text>

        <View className="mt-8">
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
        </View>

        {sent ? (
          <View className="mt-6 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row">
            <Ionicons name="checkmark-circle" size={20} color="#047857" />
            <Text className="ml-2 flex-1 text-sm text-brand-700 leading-5">
              If an account exists for {email}, a reset link is on its way.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-3 flex-row">
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text className="ml-2 flex-1 text-sm text-danger">{error}</Text>
          </View>
        ) : null}

        <View className="mt-8">
          <Button
            label={sent ? 'Back to sign in' : 'Send reset link'}
            size="lg"
            fullWidth
            loading={loading}
            onPress={submit}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
