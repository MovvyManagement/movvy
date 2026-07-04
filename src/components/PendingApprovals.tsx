// =============================================================================
// PendingApprovals — owner-facing "request to join" queue (Option C)
//
// Shared by /(mover)/crew (team operator) and /(company)/drivers (company
// owner/dispatcher). Under Option C anyone with a valid team/company invite
// code can sign up and self-join — they land in status='pending_approval' and
// surface here for the owner to Approve (→ active, joins the roster) or Decline
// (→ rejected, with an optional reason the applicant sees). Renders nothing
// until someone actually asks to join, so it stays out of the way.
//
// Data + actions come straight from the hooks in lib/data/useDispatch:
//   • usePendingJoinRequests(kind, subjectId) — server-gated so ONLY an active
//     operator / owner / dispatcher ever receives rows (polls every 20s).
//   • useResolveJoinRequest() — invokes partners-approve-join, which flips the
//     member row, notifies the applicant, audit-logs the decision, and
//     invalidates the roster so an approved member appears immediately.
// =============================================================================

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { Input } from './Input';
import { useToast } from './Toast';
import {
  usePendingJoinRequests,
  useResolveJoinRequest,
  type PendingJoinRequest,
} from '@/lib/data';
import { fmtRelativeAgo, fmtPhone } from '@/lib/format';
import { haptic } from '@/lib/haptics';

const IS_IOS = Platform.OS === 'ios';

// Humanise the stored member role for each org type. Team codes bring on either
// the operator or hourly movers; company codes bring on drivers (dispatchers /
// owners are only ever created by explicit invite, never self-join, but we
// label them defensively).
function roleLabel(kind: 'team' | 'company', role: string): string {
  if (kind === 'team') return role === 'driver' ? 'Operator' : 'Hourly mover';
  if (role === 'owner') return 'Owner';
  if (role === 'dispatcher') return 'Dispatcher';
  return 'Driver';
}

interface Props {
  kind: 'team' | 'company';
  subjectId: string | null;
}

export function PendingApprovals({ kind, subjectId }: Props) {
  const { data: requests } = usePendingJoinRequests(kind, subjectId);
  const resolve = useResolveJoinRequest();
  const toast = useToast();

  // Which applicant is mid-approve — locks its row's buttons and swaps in a
  // spinner. Declines route through the sheet, so only approve locks inline.
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingJoinRequest | null>(null);

  // Stay invisible until someone actually asks to join — mirrors the
  // "Invites sent" section, which only appears when it has something to show.
  if (!subjectId || !requests || requests.length === 0) return null;

  const approve = async (req: PendingJoinRequest) => {
    if (approvingId) return;
    setApprovingId(req.profile_id);
    try {
      haptic.medium();
      const res = await resolve.mutateAsync({
        subject_type: kind,
        subject_id: subjectId,
        applicant_profile_id: req.profile_id,
        decision: 'approve',
      });
      haptic.success();
      toast.success(`${res.applicant_name} is on the roster`);
    } catch (e: any) {
      haptic.error();
      toast.error(e?.message ?? 'Could not approve. Try again.');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <>
      <View className="flex-row items-center mt-6 mb-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Pending approvals
        </Text>
        <View className="ml-2 px-2 py-0.5 rounded-full bg-amber-500">
          <Text className="text-[11px] font-bold text-white">{requests.length}</Text>
        </View>
      </View>

      {requests.map((req) => {
        const busy = approvingId === req.profile_id;
        const contact = req.email ?? fmtPhone(req.phone) ?? '—';
        const name = req.full_name ?? 'New member';
        return (
          <View
            key={req.profile_id}
            className="rounded-2xl border border-amber-100 bg-amber-50 p-4 mb-3"
          >
            <View className="flex-row items-center">
              <Avatar name={name} size={44} />
              <View className="ml-3 flex-1">
                <Text className="text-base font-bold text-ink-900" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="text-xs text-silver-600 mt-0.5" numberOfLines={1}>
                  {contact}
                </Text>
                <Text className="text-[11px] text-silver-500 mt-0.5">
                  {roleLabel(kind, req.member_role)} · asked {fmtRelativeAgo(req.requested_at)}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-2 mt-3">
              <Pressable
                onPress={() => approve(req)}
                disabled={busy}
                className={`flex-1 h-11 rounded-xl flex-row items-center justify-center ${
                  busy ? 'bg-brand-400' : 'bg-brand-600 active:opacity-90'
                }`}
                accessibilityRole="button"
                accessibilityLabel={`Approve ${name}`}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={17} color="#fff" />
                    <Text className="ml-1.5 text-sm font-bold text-white">Approve</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => {
                  haptic.light();
                  setRejectTarget(req);
                }}
                disabled={busy}
                className="flex-1 h-11 rounded-xl border border-silver-300 bg-white flex-row items-center justify-center active:opacity-80"
                accessibilityRole="button"
                accessibilityLabel={`Decline ${name}`}
              >
                <Ionicons name="close" size={17} color="#71717A" />
                <Text className="ml-1.5 text-sm font-bold text-silver-600">Decline</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <RejectSheet
        target={rejectTarget}
        kind={kind}
        subjectId={subjectId}
        onClose={() => setRejectTarget(null)}
      />
    </>
  );
}

// ─── Decline sheet ───────────────────────────────────────────────────────────
// Confirms the decline and captures an optional reason (shown to the applicant
// on their waiting screen). Built as a plain bottom sheet so it works
// identically on iOS + Android in Expo Go — Alert.prompt is iOS-only and would
// silently give Android no way to type a reason.
function RejectSheet({
  target,
  kind,
  subjectId,
  onClose,
}: {
  target: PendingJoinRequest | null;
  kind: 'team' | 'company';
  subjectId: string;
  onClose: () => void;
}) {
  const resolve = useResolveJoinRequest();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setReason('');
    onClose();
  };

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      haptic.medium();
      const res = await resolve.mutateAsync({
        subject_type: kind,
        subject_id: subjectId,
        applicant_profile_id: target.profile_id,
        decision: 'reject',
        reason: reason.trim() || undefined,
      });
      haptic.success();
      toast.info(`${res.applicant_name} was declined`);
      setReason('');
      onClose();
    } catch (e: any) {
      haptic.error();
      toast.error(e?.message ?? 'Could not decline. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const name = target?.full_name ?? 'this person';

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={IS_IOS ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable
          onPress={close}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <SafeAreaView edges={['bottom']} className="rounded-t-3xl bg-white">
              <View className="px-5 pt-5 pb-4">
                {IS_IOS ? null : (
                  <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
                )}
                <Text className="text-lg font-bold text-ink-900">Decline {name}?</Text>
                <Text className="mt-1 text-sm text-silver-500 leading-5">
                  They'll be told they weren't approved to join. Add a short
                  reason if you'd like — they'll see it.
                </Text>

                <View className="mt-4">
                  <Input
                    label="Reason (optional)"
                    placeholder="e.g. Can't verify your details"
                    value={reason}
                    onChangeText={setReason}
                    maxLength={140}
                    autoCapitalize="sentences"
                    returnKeyType="done"
                    onSubmitEditing={submit}
                  />
                </View>

                <Pressable
                  onPress={submit}
                  disabled={busy}
                  className={`mt-5 h-14 rounded-2xl items-center justify-center flex-row ${
                    busy ? 'bg-rose-400' : 'bg-rose-600 active:opacity-90'
                  }`}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm decline"
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-base font-bold text-white">Decline request</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={close}
                  disabled={busy}
                  className="mt-2 h-11 items-center justify-center"
                >
                  <Text className="text-sm font-semibold text-silver-500">Keep pending</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
