import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useRequireAuth, supabaseConfigured } from '@/lib/supabase';
import { useThemedColors } from '@/lib/theme';
import { useSetMyPresence } from '@/lib/data';
import { RoleSurfaceGuard } from '@/components/RoleSurfaceGuard';
import { PartnerOnboardingGate } from '@/components/PartnerOnboardingGate';

// =============================================================================
// Driver (mover) route group — Stack on top of Tabs (mirrors the company side).
//
// The bottom Tabs (Dashboard · Jobs · Earnings · Profile) live in (tabs)/.
// Every "pushed" driver screen (active, the job detail, availability,
// referrals, navigate, onboarding, notifications) sits at this Stack level —
// so router.push to one of them is a real Stack push, not a tab switch, and
// back / iOS edge-swipe returns to the tab the driver came from instead of
// snapping to the Dashboard.
//
// The auth guard lives here at the Stack level (not in (tabs)) so it gates the
// whole surface — pushed screens included — exactly like the company group.
// =============================================================================

export default function MoverStack() {
  const { ready } = useRequireAuth();
  const palette = useThemedColors();

  // Partners are always online while the driver app is open. We removed the
  // manual Online/Offline toggle, so mark presence online once auth is ready
  // and leave it that way for the whole session — the matcher + the company
  // assign-driver picker keep seeing them as available.
  const setPresence = useSetMyPresence();
  const presenceMarked = useRef(false);
  useEffect(() => {
    if (ready && supabaseConfigured && !presenceMarked.current) {
      presenceMarked.current = true;
      setPresence.mutate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (supabaseConfigured && !ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.appBg,
        }}
      >
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <RoleSurfaceGuard surface="mover" />
      <PartnerOnboardingGate />
    </>
  );
}
