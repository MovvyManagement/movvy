// Expo Push device-token registration.
// Call this once after the user is authed.

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';

export function useRegisterDeviceToken() {
  return useMutation({
    mutationFn: async (args: { expo_push_token: string; platform: 'ios' | 'android' | 'web' }) => {
      const { data, error } = await supabase.functions.invoke('device-tokens-register', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
}

/**
 * Lazily request push permission + register the token whenever auth state flips
 * to "signed in". On web this is a no-op (expo-notifications doesn't run there).
 */
export function useAutoRegisterPushToken() {
  const { session } = useAuth();
  const register = useRegisterDeviceToken();

  useEffect(() => {
    if (!session?.user) return;
    if (Platform.OS === 'web') return;

    let cancelled = false;
    (async () => {
      try {
        // Lazy import keeps the package out of the web bundle
        const Notifications = await import('expo-notifications');

        // ANDROID: a notification channel MUST exist or Android 8+ silently
        // drops heads-up notifications (they'd never appear on the driver's
        // phone). iOS has no channels — this is Android-only parity.
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Movvy',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#059669',
          });
        }

        const { status: existing } = await Notifications.getPermissionsAsync();
        const final = existing === 'granted'
          ? existing
          : (await Notifications.requestPermissionsAsync()).status;
        if (final !== 'granted') return;

        const tokenResult = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;
        await register.mutateAsync({
          expo_push_token: tokenResult.data,
          platform: Platform.OS as 'ios' | 'android',
        });
      } catch (err) {
        // expo-notifications might not be installed yet; non-fatal
        // eslint-disable-next-line no-console
        console.warn('[push] registration skipped:', (err as Error).message);
      }
    })();

    return () => { cancelled = true; };
  }, [session?.user?.id]);
}
