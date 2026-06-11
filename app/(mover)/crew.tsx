// =============================================================================
// /(mover)/crew — independent-operator crew management
//
// The team analog of /(company)/drivers. Reached from the driver Profile tab,
// but ONLY for the team operator (the team's `driver` role). It gives a solo /
// independent operator the same crew-building tools a company has:
//   • their auto-generated team invite code (share + copy)
//   • a live roster of the crew (operator + hourly movers) with presence +
//     active-job state, via the partner_team_roster() RPC (migration 0040)
//   • an "Add mover" flow that fires partners-invite-send so the mover gets an
//     SMS/email with the team code, plus a pending-invite list
//
// Movers themselves are hourly laborers — they never see this screen (their
// Profile has no Crew link) and revenue stays hidden from them. We still gate
// defensively here in case of a deep link or stale navigation.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PhoneInput, toE164, isPhoneComplete } from '@/components/PhoneInput';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import {
  useMyMembership,
  usePartnerTeamRoster,
  useMyTeam,
  useSendPartnerInvites,
  useTeamInvites,
} from '@/lib/data';
import { supabaseConfigured, useAuth } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';

export default function Crew() {
  const { user } = useAuth();
  const { data: membership } = useMyMembership();
  const teamId = membership?.kind === 'team' ? membership.team_id : null;
  // Only the team's operator (driver) builds + manages the crew.
  const isOperator = membership?.kind === 'team' && membership?.role === 'driver';

  const { data: team } = useMyTeam(teamId);
  const { data: roster, isLoading, refetch, isRefetching } = usePartnerTeamRoster(teamId);
  const { data: invites } = useTeamInvites(teamId ?? undefined);

  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const inviteCode = team?.invite_code ?? null;
  const total = roster?.length ?? 0;
  const online = roster?.filter((m) => m.is_online).length ?? 0;
  // Show live invites: still-outstanding (sent/pending) plus declined (so the
  // operator knows someone said no). Accepted movers already appear in the
  // roster above; cancelled/expired are dead and would just be noise.
  const pending = (invites ?? []).filter(
    (i) => i.status === 'sent' || i.status === 'pending' || i.status === 'declined',
  );

  const copyCode = async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Defensive gate: a mover (or non-team user) should never land here.
  if (membership && !isOperator) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Crew" showBack />
        </View>
        <EmptyState
          icon="people-outline"
          title="Managed by your operator"
          body="Your crew and schedule are set by the operator who runs your team."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Your crew"
          subtitle={membership?.team_name ?? undefined}
          showBack
          right={
            <Pressable
              onPress={() => {
                haptic.light();
                setShowInvite(true);
              }}
              className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center active:opacity-90"
              accessibilityLabel="Invite a mover"
            >
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          }
        />
      </View>

      {isLoading && !roster ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <CardSkeleton count={3} />
        </ScrollView>
      ) : !supabaseConfigured ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase in .env.local to load your live crew."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor="#16A34A"
            />
          }
        >
          {/* ─── Invite code card ──────────────────────────────────────────── */}
          <View className="rounded-3xl bg-white dark:bg-night-100 border border-brand-100 dark:border-night-50 p-5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
              Your team invite code
            </Text>
            {inviteCode ? (
              <>
                <Text
                  selectable
                  className="mt-2 text-3xl font-bold text-ink-900 dark:text-mist-50"
                  style={{ letterSpacing: 2 }}
                >
                  {inviteCode}
                </Text>
                <Text className="mt-2 text-xs text-silver-500 leading-5">
                  Share this with anyone you want on your crew. They enter it
                  with the email or phone you invite them with to join as an
                  hourly mover.
                </Text>
                <Pressable
                  onPress={copyCode}
                  className="mt-4 h-12 flex-row items-center justify-center rounded-2xl bg-brand-600 active:opacity-90"
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color="#fff" />
                  <Text className="ml-2 text-sm font-bold text-white">
                    {copied ? 'Copied!' : 'Copy code'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Text className="mt-2 text-sm text-silver-500">
                Generating your code… pull to refresh in a moment.
              </Text>
            )}
          </View>

          {/* ─── Crew stats ────────────────────────────────────────────────── */}
          <View className="flex-row gap-3 mt-4">
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Crew size</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{total}</Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-silver-500 uppercase font-semibold">Online now</Text>
              <Text className="text-2xl font-bold text-ink-900 mt-1">{online}</Text>
            </Card>
          </View>

          {/* ─── Roster ────────────────────────────────────────────────────── */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
            On your crew
          </Text>
          {!roster || roster.length === 0 ? (
            <Card>
              <Text className="text-sm text-silver-500">
                It's just you for now. Tap + to invite a mover to your crew.
              </Text>
            </Card>
          ) : (
            roster.map((m) => {
              const onJob = m.active_jobs > 0;
              const isYou = m.profile_id === user?.id;
              const statusLabel = !m.is_online ? 'Offline' : onJob ? 'On job' : 'Online';
              const statusTone: 'neutral' | 'warning' | 'success' = !m.is_online
                ? 'neutral'
                : onJob
                ? 'warning'
                : 'success';
              return (
                <View key={m.profile_id} className="mb-3">
                  <Card>
                    <View className="flex-row items-center">
                      <View className="relative">
                        <Avatar name={m.full_name ?? 'Crew'} size={48} />
                        <View
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                            m.is_online ? 'bg-brand-600' : 'bg-silver-400'
                          }`}
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-base font-bold text-ink-900">
                            {m.full_name ?? '—'}
                          </Text>
                          {isYou ? (
                            <Text className="text-[11px] font-semibold text-brand-700">You</Text>
                          ) : null}
                        </View>
                        <Text className="text-xs text-silver-500 mt-0.5">
                          {m.role === 'driver' ? 'Operator · accepts jobs' : 'Hourly mover'}
                        </Text>
                        <Text className="text-xs text-silver-500">
                          {onJob ? `${m.active_jobs} active` : '0 active'}
                        </Text>
                      </View>
                      <Badge label={statusLabel} tone={statusTone} />
                    </View>
                  </Card>
                </View>
              );
            })
          )}

          {/* ─── Pending invites ───────────────────────────────────────────── */}
          {pending.length > 0 ? (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
                Invites sent
              </Text>
              {pending.map((inv) => (
                <View
                  key={inv.id}
                  className="rounded-2xl border border-silver-200 bg-white p-3 mb-2 flex-row items-center"
                >
                  <View
                    className={`h-9 w-9 rounded-full items-center justify-center ${
                      inv.status === 'declined' ? 'bg-rose-100' : 'bg-silver-100'
                    }`}
                  >
                    <Ionicons
                      name={
                        inv.status === 'declined'
                          ? 'close'
                          : inv.last_channel === 'sms'
                          ? 'chatbubble-outline'
                          : 'mail-outline'
                      }
                      size={16}
                      color={inv.status === 'declined' ? '#E11D48' : '#71717A'}
                    />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-bold text-ink-900">
                      {inv.full_name ?? inv.email ?? inv.phone}
                    </Text>
                    <Text className="text-xs text-silver-500">
                      {inv.phone ?? inv.email}
                      {' · '}
                      {inv.status === 'declined'
                        ? 'Declined'
                        : inv.status === 'sent'
                        ? `${inv.last_channel?.toUpperCase() ?? 'SENT'} delivered`
                        : 'Pending'}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      <InviteMoverModal
        visible={showInvite}
        teamId={teamId}
        onClose={() => setShowInvite(false)}
      />
    </SafeAreaView>
  );
}

// ─── Add-mover sheet ──────────────────────────────────────────────────────────
// Collects a name + email and/or phone, then fires partners-invite-send with
// role:'mover'. The edge function inserts the partner_invites row and dispatches
// the SMS/email; useSendPartnerInvites invalidates the team-invites query so the
// pending list refreshes on close.
function InviteMoverModal({
  visible,
  teamId,
  onClose,
}: {
  visible: boolean;
  teamId: string | null;
  onClose: () => void;
}) {
  const sendInvites = useSendPartnerInvites();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(''); // digits-only

  const emailValid = email.includes('@');
  const phoneValid = isPhoneComplete(phone);
  const canSend = fullName.trim().length > 0 && (emailValid || phoneValid) && !!teamId;

  const reset = () => {
    setFullName('');
    setEmail('');
    setPhone('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!canSend || !teamId) return;
    try {
      haptic.medium();
      await sendInvites.mutateAsync({
        team_id: teamId,
        invites: [
          {
            role: 'mover',
            full_name: fullName.trim(),
            email: emailValid ? email.trim() : undefined,
            phone: phoneValid ? toE164(phone) : undefined,
          },
        ],
      });
      haptic.success();
      close();
    } catch (e: any) {
      haptic.error();
      Alert.alert('Could not send invite', e?.message ?? 'Try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable className="absolute inset-0 bg-black/40" onPress={close} />
        <View className="rounded-t-3xl bg-white dark:bg-night-100 px-5 pt-5 pb-9">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-lg font-bold text-ink-900 dark:text-mist-50">Invite a mover</Text>
            <Pressable onPress={close} hitSlop={10}>
              <Ionicons name="close" size={24} color="#71717A" />
            </Pressable>
          </View>
          <Text className="text-xs text-silver-500 mb-4 leading-5">
            They'll get a text or email with your team code and join as an
            hourly mover. They're paid a wage — job prices stay private to you.
          </Text>

          <Input
            label="Full name"
            placeholder="Jordan Lee"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
          <View className="h-3" />
          <Input
            label="Email"
            placeholder="jordan@email.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            hint="Email and/or phone — at least one is required."
          />
          <View className="h-3" />
          <PhoneInput label="Phone" value={phone} onChangeText={setPhone} />

          <View className="mt-5">
            <Button
              label="Send invite"
              size="lg"
              fullWidth
              disabled={!canSend}
              loading={sendInvites.isPending}
              onPress={submit}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
