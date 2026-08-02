// =============================================================================
// RoleSurfaceGuard — live "your role changed" banner.
//
// The partner app decides which SURFACE you're in (admin/dispatch = (company),
// crew/perform = (mover)) at login. If an admin promotes/demotes you while
// you're using the app, your `org_role` changes under you but you stay on the
// old surface. This guard watches the LIVE role and, when it no longer matches
// the surface you're on, shows a one-tap banner to switch — instead of yanking
// the screen out from under you.
//
// Flip-flop safe: the banner's visibility AND its destination are both derived
// from the live role every render, and the tap reads a ref of the latest role.
// So promote-then-demote-a-second-later just makes the banner disappear on its
// own (you're already on the right surface), and a tap always lands on wherever
// your CURRENT role belongs — never a stale target.
// =============================================================================

import React, { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMyMembership } from '@/lib/data';
import { haptic } from '@/lib/haptics';

type Surface = 'company' | 'mover';

const surfaceForRole = (role: string | null | undefined): Surface | null =>
  role === 'admin' ? 'company' : role === 'crew' ? 'mover' : null;

export function RoleSurfaceGuard({ surface }: { surface: Surface }) {
  const { data: membership } = useMyMembership();
  const insets = useSafeAreaInsets();

  const orgRole = membership?.org_role ?? null;
  // Keep the freshest role in a ref so a tap routes correctly even if the role
  // changed again between render and press.
  const roleRef = useRef(orgRole);
  roleRef.current = orgRole;

  const expected = surfaceForRole(orgRole);
  // Only nudge when we KNOW the role and it points at a different surface.
  const mismatch = expected != null && expected !== surface;
  if (!mismatch) return null;

  const go = () => {
    haptic.light();
    const dest = surfaceForRole(roleRef.current);
    router.replace(
      (dest === 'company'
        ? '/(company)/(tabs)/dashboard'
        : '/(mover)/(tabs)/dashboard') as any,
    );
  };

  const becameAdmin = expected === 'company';

  return (
    <Pressable
      onPress={go}
      style={{ position: 'absolute', top: insets.top + 6, left: 12, right: 12 }}
      className="rounded-2xl bg-ink-900 px-4 py-3 flex-row items-center active:opacity-90"
    >
      <View className="h-8 w-8 rounded-full bg-brand-600 items-center justify-center">
        <Ionicons name={becameAdmin ? 'people' : 'navigate'} size={16} color="#fff" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-sm font-bold text-white">
          {becameAdmin ? "You're now an admin" : 'Your role changed to crew'}
        </Text>
        <Text className="text-[11px] text-white/70">
          Tap to switch to the {becameAdmin ? 'admin' : 'crew'} view
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#fff" />
    </Pressable>
  );
}
