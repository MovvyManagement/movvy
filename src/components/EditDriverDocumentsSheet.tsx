// =============================================================================
// EditDriverDocumentsSheet
//
// Shows every verification document Movvy has on file for the signed-in
// driver — government ID, license, selfie + ID (profile-scoped) and vehicle
// insurance + business registration (team-scoped). The driver can re-upload
// any one of them; the new file replaces the old one and goes back to
// "In review" status until Movvy approves it.
//
// Mirrors the company-side EditInsuranceSheet pattern but covers the full set
// of mover documents in one place.
// =============================================================================

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { pickPhoto } from '@/lib/pickPhoto';
import { useQueryClient } from '@tanstack/react-query';
import { useMyDriverDocuments, useUploadDocument } from '@/lib/data';
import { useAuth } from '@/lib/supabase';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  teamId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

type DocKind =
  | 'gov_id'
  | 'driver_license'
  | 'selfie_with_id'
  | 'vehicle_registration'
  | 'insurance'
  | 'business_registration';

interface DocSpec {
  kind: DocKind;
  label: string;
  sub: string;
  scope: 'profile' | 'team';
  required: boolean;
}

const DOCS: DocSpec[] = [
  {
    kind: 'gov_id',
    label: 'Government ID',
    sub: 'Driver license or passport',
    scope: 'profile',
    required: true,
  },
  {
    kind: 'driver_license',
    label: 'Driver license',
    sub: 'Valid Alberta class 5 or equivalent',
    scope: 'profile',
    required: true,
  },
  {
    kind: 'selfie_with_id',
    label: 'Selfie with ID',
    sub: 'You holding your government ID',
    scope: 'profile',
    required: true,
  },
  {
    // Proof the truck is actually theirs. Required before ANY job can be
    // accepted — org_can_take_booking() blocks accepts without it.
    kind: 'vehicle_registration',
    label: 'Truck registration',
    sub: 'Proof the truck is registered to you or your company',
    scope: 'profile',
    required: true,
  },
  {
    kind: 'insurance',
    label: 'Vehicle insurance',
    sub: 'Commercial coverage preferred',
    scope: 'team',
    required: true,
  },
  {
    kind: 'business_registration',
    label: 'Business registration',
    sub: 'GST # if registered — optional',
    scope: 'team',
    required: false,
  },
];

export function EditDriverDocumentsSheet({ visible, teamId, onClose }: Props) {
  const { user } = useAuth();
  const { data: docs } = useMyDriverDocuments(teamId);
  const upload = useUploadDocument();
  const toast = useToast();
  const qc = useQueryClient();
  const [busyKind, setBusyKind] = useState<DocKind | null>(null);

  const pick = async (spec: DocSpec) => {
    if (spec.scope === 'team' && !teamId) {
      toast.error('Finish onboarding your team to upload this one.');
      return;
    }
    if (spec.scope === 'profile' && !user) return;

    const file = await pickPhoto(spec.kind, spec.label ?? 'Document');
    if (!file) return;

    setBusyKind(spec.kind);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind: spec.kind,
        subject_type: spec.scope,
        subject_id: spec.scope === 'profile' ? user!.id : teamId!,
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mime,
      });
      qc.invalidateQueries({ queryKey: ['my-driver-documents', user?.id, teamId] });
      haptic.success();
      toast.success('Uploaded — Movvy will review it shortly');
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setBusyKind(null);
    }
  };

  const body = (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }}>
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Documents</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Movvy reviews every upload — usually within one business day. Replace
        a document any time it's renewed, lost, or rejected.
      </Text>

      <View className="mt-5 gap-3">
        {DOCS.map((spec) => {
          const onFile = docs?.find((d) => d.kind === spec.kind);
          const busy = busyKind === spec.kind;
          const blocked = spec.scope === 'team' && !teamId;
          const status = onFile?.status ?? null;

          const badge = (() => {
            if (!onFile) return { label: 'Not uploaded', tone: 'text-silver-500', bg: 'bg-silver-100' };
            if (status === 'approved') return { label: 'Approved', tone: 'text-brand-700', bg: 'bg-brand-50' };
            if (status === 'rejected') return { label: 'Rejected', tone: 'text-danger', bg: 'bg-red-50' };
            if (status === 'expired') return { label: 'Expired', tone: 'text-warning', bg: 'bg-amber-50' };
            return { label: 'In review', tone: 'text-amber-700', bg: 'bg-amber-50' };
          })();

          return (
            <View key={spec.kind} className="rounded-2xl border border-silver-200 p-4">
              <View className="flex-row items-center">
                <View className="h-11 w-11 rounded-2xl bg-silver-100 items-center justify-center">
                  <Ionicons
                    name={
                      spec.kind === 'selfie_with_id'
                        ? 'happy-outline'
                        : spec.kind === 'insurance'
                        ? 'shield-checkmark-outline'
                        : 'document-text-outline'
                    }
                    size={20}
                    color="#0A0A0A"
                  />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-base font-bold text-ink-900">
                    {spec.label}
                    {!spec.required ? (
                      <Text className="text-xs text-silver-500 font-normal"> · optional</Text>
                    ) : null}
                  </Text>
                  <Text className="text-xs text-silver-500 mt-0.5" numberOfLines={2}>
                    {spec.sub}
                  </Text>
                </View>
                <View className={`px-2 py-1 rounded-full ${badge.bg}`}>
                  <Text className={`text-[11px] font-bold ${badge.tone}`}>{badge.label}</Text>
                </View>
              </View>

              {onFile?.expires_at ? (
                <Text className="mt-2 text-xs text-silver-500">
                  Expires {new Date(onFile.expires_at).toLocaleDateString()}
                </Text>
              ) : null}

              {status === 'rejected' && onFile?.rejection_reason ? (
                <View className="mt-3 rounded-xl bg-red-50 p-3">
                  <Text className="text-xs text-danger">
                    <Text className="font-bold">Rejected: </Text>
                    {onFile.rejection_reason}
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={() => pick(spec)}
                disabled={busy || blocked}
                className={`mt-3 h-11 rounded-2xl items-center justify-center flex-row border ${
                  blocked
                    ? 'border-silver-200 bg-silver-50'
                    : busy
                    ? 'border-silver-200 bg-silver-50'
                    : onFile
                    ? 'border-silver-300 bg-white active:opacity-70'
                    : 'border-brand-600 bg-brand-600 active:opacity-90'
                }`}
                accessibilityRole="button"
                accessibilityLabel={`${onFile ? 'Replace' : 'Upload'} ${spec.label}`}
              >
                {busy ? (
                  <ActivityIndicator color="#71717A" />
                ) : blocked ? (
                  <Text className="text-sm text-silver-500">Finish team onboarding to upload</Text>
                ) : (
                  <>
                    <Ionicons
                      name={onFile ? 'refresh' : 'cloud-upload-outline'}
                      size={16}
                      color={onFile ? '#0A0A0A' : '#fff'}
                    />
                    <Text
                      className={`ml-2 text-sm font-bold ${
                        onFile ? 'text-ink-900' : 'text-white'
                      }`}
                    >
                      {onFile ? 'Replace' : 'Upload'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>

      <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row">
        <Ionicons name="lock-closed-outline" size={18} color="#71717A" />
        <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
          Uploads go straight to encrypted storage over a signed URL. Only Movvy
          admins reviewing your file can open them.
        </Text>
      </View>

      <Pressable onPress={onClose} className="mt-4 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Done</Text>
      </Pressable>
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            {body}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            {body}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
