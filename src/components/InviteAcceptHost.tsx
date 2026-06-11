// =============================================================================
// InviteAcceptHost
//
// Mounted on the mover + company layouts. Polls partner_invites for any
// invite whose email/phone matches the signed-in user's profile, and pops
// a modal:  "You've been invited to join [X]'s fleet — Accept / Decline".
//
// Single source of truth for the invitee-side response flow. The owner
// side (dispatcher sending invites, cancelling them) lives in
// (company)/dispatch + (mover)/onboarding/pending.
//
// Mirrors the structure of ReviewPromptHost: passive component, no
// children, mounts cleanly into any layout.
// =============================================================================

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMyPendingInvites, useRespondToInvite } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

export function InviteAcceptHost() {
  const { data: invites } = useMyPendingInvites();
  const respond = useRespondToInvite();
  const toast = useToast();

  // Track which invite id has been resolved-this-session so the popup
  // doesn't immediately reappear during the network round-trip.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Pick the FIRST unresolved pending invite — we surface one at a time so
  // the user isn't drowning in stacked modals.
  const current = (invites ?? []).find((inv) => !dismissed.has(inv.id));
  if (!current) return null;

  const teamLabel =
    current.company_name ??
    current.team_name ??
    (current.team_id ? 'a Movvy team' : "a Movvy company");

  const onAccept = async () => {
    try {
      const res = await respond.mutateAsync({ invite_id: current.id, decision: 'accept' });
      setDismissed((s) => new Set(s).add(current.id));
      haptic.success();
      toast.success(
        res.status === 'accepted' || res.already_resolved
          ? `Welcome to ${teamLabel}!`
          : 'Invite processed',
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't accept the invite. Try again.");
    }
  };

  const onDecline = async () => {
    try {
      await respond.mutateAsync({ invite_id: current.id, decision: 'decline' });
      setDismissed((s) => new Set(s).add(current.id));
      toast.info(`Declined invite to ${teamLabel}.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't decline the invite. Try again.");
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { /* deliberate no-op — force a decision */ }}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            padding: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 12,
          }}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: 4 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: '#ECFDF5',
                alignItems: 'center',
                justifyContent: 'center',
                alignSelf: 'center',
              }}
            >
              <Ionicons name="people" size={30} color="#047857" />
            </View>

            <Text
              style={{
                marginTop: 16,
                fontSize: 22,
                fontWeight: '700',
                color: '#0A0A0A',
                textAlign: 'center',
              }}
            >
              You're invited
            </Text>
            <Text
              style={{
                marginTop: 8,
                fontSize: 15,
                color: '#52525B',
                textAlign: 'center',
                lineHeight: 21,
              }}
            >
              <Text style={{ fontWeight: '700', color: '#0A0A0A' }}>{teamLabel}</Text>{' '}
              has invited you to join their fleet as a{' '}
              <Text style={{ fontWeight: '600', color: '#047857' }}>
                {current.role === 'driver'
                  ? 'driver'
                  : current.role === 'mover'
                  ? 'mover'
                  : 'dispatcher'}
              </Text>
              .
            </Text>

            <View
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 14,
                backgroundColor: '#F4F4F5',
              }}
            >
              <Text style={{ fontSize: 11, color: '#71717A', lineHeight: 16 }}>
                Accepting links your account to this team. You'll see jobs
                assigned by their dispatcher. Decline if this wasn't you —
                we'll let the owner know.
              </Text>
            </View>

            <Pressable
              onPress={onAccept}
              disabled={respond.isPending}
              style={{
                marginTop: 20,
                height: 56,
                borderRadius: 16,
                backgroundColor: respond.isPending ? '#A1A1AA' : '#16A34A',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
              }}
            >
              {respond.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={{ marginLeft: 8, fontSize: 16, fontWeight: '700', color: '#fff' }}>
                    Accept · join {teamLabel}
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={onDecline}
              disabled={respond.isPending}
              style={{
                marginTop: 10,
                height: 48,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: '#E4E4E7',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#52525B' }}>
                Decline
              </Text>
            </Pressable>

            {/* "Not now" is intentionally NOT offered — half-pending invites
                would clutter the dispatcher's view forever. Force a decision. */}
            <Text
              style={{
                marginTop: 12,
                fontSize: 10,
                color: '#A1A1AA',
                textAlign: 'center',
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              }}
            >
              Invite #{current.id.slice(0, 8)}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
