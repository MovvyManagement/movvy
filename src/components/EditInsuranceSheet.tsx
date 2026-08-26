// =============================================================================
// EditInsuranceSheet
//
// Manages the company's two insurance docs:
//   • Commercial liability   (document_kind = 'insurance')
//   • Fleet insurance        (document_kind = 'fleet_insurance')
//
// Both feed verification_documents with subject = company. Movvy ops sees
// every upload in the admin Users/Disputes flows and approves / rejects.
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
import { useCompanyDocuments, useUploadDocument } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import type { CompanyDocRow } from '@/lib/data';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

const KINDS: { key: 'insurance' | 'fleet_insurance'; label: string; sub: string }[] = [
  {
    key: 'insurance',
    label: 'Commercial liability',
    sub: 'Minimum $2M coverage — protects the customer for property damage.',
  },
  {
    key: 'fleet_insurance',
    label: 'Fleet insurance',
    sub: 'Commercial auto policy covering every truck on the road.',
  },
];

export function EditInsuranceSheet({ visible, companyId, onClose }: Props) {
  const { data: docs } = useCompanyDocuments(companyId);
  const upload = useUploadDocument();
  const toast = useToast();
  const qc = useQueryClient();
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const pick = async (kind: 'insurance' | 'fleet_insurance') => {
    if (!companyId) return;
    const file = await pickPhoto(kind, KINDS.find((k) => k.key === kind)?.label ?? 'Document');
    if (!file) return;
    setBusyKind(kind);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind,
        subject_type: 'company',
        subject_id: companyId,
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mime,
      });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
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

      <Text className="text-2xl font-bold text-ink-900">Insurance</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Customers see a "Insured & vetted" badge when both policies are
        approved. Movvy reviews every upload — typically within one
        business day.
      </Text>

      <View className="mt-5 gap-3">
        {KINDS.map((k) => {
          const onFile = docs?.find((d) => d.kind === k.key) as CompanyDocRow | undefined;
          const busy = busyKind === k.key;
          const status = onFile?.status ?? null;
          const badge = (() => {
            if (!onFile) return { label: 'Not uploaded', tone: 'text-silver-500', bg: 'bg-silver-100' };
            if (status === 'approved') return { label: 'Approved', tone: 'text-brand-700', bg: 'bg-brand-50' };
            if (status === 'rejected') return { label: 'Rejected', tone: 'text-danger', bg: 'bg-red-50' };
            if (status === 'expired') return { label: 'Expired', tone: 'text-warning', bg: 'bg-amber-50' };
            return { label: 'In review', tone: 'text-amber-700', bg: 'bg-amber-50' };
          })();

          return (
            <View key={k.key} className="rounded-2xl border border-silver-200 p-4">
              <View className="flex-row items-center">
                <View className="h-11 w-11 rounded-2xl bg-silver-100 items-center justify-center">
                  <Ionicons name="shield-checkmark-outline" size={20} color="#0A0A0A" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-base font-bold text-ink-900">{k.label}</Text>
                  <Text className="text-xs text-silver-500 mt-0.5" numberOfLines={2}>
                    {k.sub}
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
                onPress={() => pick(k.key)}
                disabled={busy}
                className={`mt-3 h-11 rounded-2xl items-center justify-center flex-row border ${
                  busy
                    ? 'border-silver-200 bg-silver-50'
                    : onFile
                    ? 'border-silver-300 bg-white active:opacity-70'
                    : 'border-brand-600 bg-brand-600 active:opacity-90'
                }`}
              >
                {busy ? (
                  <ActivityIndicator color="#71717A" />
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
