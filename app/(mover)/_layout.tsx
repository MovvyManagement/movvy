import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { View, ActivityIndicator, AppState } from 'react-native';
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
  // manual Online/Offline toggle, so presence is marked for them.
  //
  // It has to be a HEARTBEAT, not a one-shot. company_drivers_roster computes
  // is_online as `is_online AND last_online_at > now() - interval '30 minutes'`,
  // so a single ping at launch expires after half an hour: the whole crew showed
  // "Offline · last seen …" to their own admin while sitting in the app, every
  // assignment went through the destructive "Assign anyway" confirm, and the
  // dashboard utilization tile read 0%.
  //
  // Ten minutes gives three pings inside the window, so one missed tick (dead
  // zone, throttled timer) doesn't flip them offline. The AppState listener
  // re-pings on foreground because JS timers don't fire reliably while
  // backgrounded — coming back to the app should mark you present immediately,
  // not up to ten minutes later.
  const setPresence = useSetMyPresence();
  const pingPresence = useRef<() => void>(() => {});
  pingPresence.current = () => {
    if (supabaseConfigured) setPresence.mutate(true);
  };

  useEffect(() => {
    if (!ready || !supabaseConfigured) return;
    pingPresence.current();
    const id = setInterval(() => pingPresence.current(), 10 * 60 * 1000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') pingPresence.current();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
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
