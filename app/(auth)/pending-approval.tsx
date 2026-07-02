// =============================================================================
// /(auth)/pending-approval — Option C waiting room
//
// Where a self-joined partner lands after signing in while their membership is
// still status='pending_approval'. We poll my_pending_membership():
//   • still pending  → show the waiting state (auto-refreshes every 15s)
//   • approved       → the row disappears from my_pending_membership (it only
//                      lists pending/rejected), so we route to the dashboard
//   • rejected       → show the reason + a way out
//
// The applicant is fully authenticated here — they just can't see jobs, appear
// on the roster, or be assigned work until the owner approves them (all
// enforced server-side by the status='active' gates in migration 0052 + the
// edge functions).
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { usePendingApprovalMembership, useMyMembership } from '@/lib/data';
import { logout } from '@/lib/supabase';

export default function PendingApproval() {
  const { data, isLoading, isFetching, refetch } = usePendingApprovalMembership();
  const membership = useMyMembership();
  const qc = useQueryClient();

  // Remember which surface they're joining while the request is pending, so we
  // know where to send them the instant they're approved (my_pending_membership
  // returns null once approved, so `data.kind` is gone by then).
  const [routedKind, setRoutedKind] = useState<'team' | 'company' | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (data?.kind) setRoutedKind(data.kind);
  }, [data?.kind]);

  // Approved (or already active) → route to the right dashboard. my_pending_
  // membership only lists pending/rejected rows, so `data === null` means the
  // owner approved us. We fall back to useMyMembership's kind if we never saw
  // a pending row (e.g. an active member who opened this screen directly).
  useEffect(() => {
    if (isLoading) return;
    if (data === null) {
      const kind = routedKind ?? membership.data?.kind ?? null;
      if (kind) {
        qc.invalidateQueries({ queryKey: ['my-membership'] });
        qc.invalidateQueries({ queryKey: ['my-pending-membership'] });
        router.replace(kind === 'company' ? '/(company)/dashboard' : '/(mover)/dashboard');
      }
      // else: nothing to route on yet — render the fallback + keep polling.
    }
  }, [isLoading, data, routedKind, membership.data?.kind, qc]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace('/');
    }
  };

  const orgName = data?.org_name ?? 'your team';

  // ── Rejected ───────────────────────────────────────────────────────────────
  // Reachable live: the owner rejects while the applicant is watching this
  // screen, or on a fresh load if a rejected row exists.
  if (data?.status === 'rejected') {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <ScreenHeader />
        <View className="flex-1 px-6 items-center justify-center">
          <View className="h-20 w-20 rounded-full bg-red-50 items-center justify-center">
            <Ionicons name="close-circle-outline" size={44} color="#EF4444" />
          </View>
          <Text className="mt-6 text-2xl font-bold text-ink-900 text-center">
            Request not approved
          </Text>
          <Text className="mt-2 text-base text-silver-500 text-center leading-6">
            {orgName} didn't approve your request to join.
          </Text>
          {data.rejected_reason ? (
            <View className="mt-5 w-full rounded-2xl bg-silver-50 p-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Reason
              </Text>
              <Text className="mt-1 text-sm text-ink-900 leading-5">
                {data.rejected_reason}
              </Text>
            </View>
          ) : null}
          <Text className="mt-5 text-sm text-silver-500 text-center leading-5">
            If you think this was a mistake, reach out to the team owner directly
            and ask them to re-invite you.
          </Text>
          <View className="mt-8 w-full">
            <Button
              label="Sign out"
              size="lg"
              fullWidth
              loading={signingOut}
              onPress={handleSignOut}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading (first fetch) ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <ScreenHeader />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E9F6E" />
          <Text className="mt-4 text-sm text-silver-500">Checking your status…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Nothing pending + we don't know where to route ────────────────────────
  // Defensive: they opened this screen with no pending/rejected row and no
  // resolvable active membership. Send them back to sign in.
  if (data === null && !routedKind && !membership.data?.kind) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <ScreenHeader />
        <View className="flex-1 px-6 items-center justify-center">
          <View className="h-20 w-20 rounded-full bg-silver-100 items-center justify-center">
            <Ionicons name="checkmark-done-outline" size={44} color="#71717A" />
          </View>
          <Text className="mt-6 text-2xl font-bold text-ink-900 text-center">
            Nothing to approve
          </Text>
          <Text className="mt-2 text-base text-silver-500 text-center leading-6">
            We couldn't find a pending request on your account. Sign in with your
            team or company code to continue.
          </Text>
          <View className="mt-8 w-full">
            <Button
              label="Go to sign in"
              size="lg"
              fullWidth
              onPress={() => router.replace('/(auth)/partner-signin')}
            />
            <Pressable onPress={handleSignOut} className="mt-4 items-center">
              <Text className="text-sm font-semibold text-silver-500">Sign out</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Pending (default waiting state) ────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <View className="flex-1 px-6 items-center justify-center">
        <View className="h-20 w-20 rounded-full bg-brand-50 items-center justify-center">
          <Ionicons name="hourglass-outline" size={44} color="#0E9F6E" />
        </View>
        <Text className="mt-6 text-2xl font-bold text-ink-900 text-center">
          Waiting for approval
        </Text>
        <Text className="mt-2 text-base text-silver-500 text-center leading-6">
          {orgName} has your request. As soon as they approve you, this screen
          unlocks automatically — you don't need to do anything.
        </Text>

        <View className="mt-6 flex-row items-center">
          {isFetching ? (
            <ActivityIndicator size="small" color="#71717A" />
          ) : (
            <Ionicons name="sync-outline" size={16} color="#A1A1AA" />
          )}
          <Text className="ml-2 text-xs text-silver-400">
            {isFetching ? 'Checking…' : 'Checking every few seconds'}
          </Text>
        </View>

        <View className="mt-8 w-full">
          <Button
            label="Check again now"
            size="lg"
            fullWidth
            loading={isFetching}
            onPress={() => refetch()}
          />
          <Pressable onPress={handleSignOut} className="mt-4 items-center" disabled={signingOut}>
            <Text className="text-sm font-semibold text-silver-500">
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>
        </View>

        <View className="mt-8 w-full rounded-2xl bg-silver-50 p-4 flex-row">
          <Ionicons name="information-circle-outline" size={18} color="#71717A" />
          <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
            While you wait, you won't see jobs or appear on the crew. Your team
            owner reviews every new member before they can start — it usually
            only takes a few minutes.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
