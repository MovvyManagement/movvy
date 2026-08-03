// =============================================================================
// TruckDocsCard — the review state of the truck's registration + insurance,
// with a re-upload on each.
//
// The registration is a hard gate (org_can_take_booking, migration 0084): until
// Movvy approves it the crew can't accept a single job. So this card has to
// answer three things without the partner asking anyone: where does it stand,
// what did the reviewer say, and how do I fix it.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from './Card';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { useFleetReadiness, useUploadDocument } from '@/lib/data';

type Kind = 'vehicle_registration' | 'insurance';

const ROWS: { key: Kind; label: string; sub: string }[] = [
  {
    key: 'vehicle_registration',
    label: 'Truck registration',
    sub: 'Required — jobs unlock once this is approved',
  },
  { key: 'insurance', label: 'Truck insurance', sub: 'Commercial auto policy' },
];

export function TruckDocsCard({ companyId }: { companyId: string | null }) {
  const { data: fleet } = useFleetReadiness();
  const upload = useUploadDocument();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Kind | null>(null);

  const replace = async (kind: Kind) => {
    if (!companyId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error('Photo library permission denied');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setBusy(kind);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind,
        subject_type: 'company',
        subject_id: companyId,
        fileUri: asset.uri,
        fileName: asset.fileName ?? `${kind}-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      qc.invalidateQueries({ queryKey: ['fleet-readiness'] });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
      haptic.success();
      toast.success('Sent to Movvy for review');
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="mb-4">
      <Card>
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
          Documents
        </Text>
        <View className="mt-3 gap-3">
          {ROWS.map((r) => {
            const doc = (fleet as any)?.[r.key === 'insurance' ? 'insurance' : 'registration'];
            const status: string = doc?.status ?? 'missing';
            const badge =
              status === 'approved'
                ? { label: 'Approved', tone: 'text-brand-700', bg: 'bg-brand-50' }
                : status === 'pending'
                  ? { label: 'In review', tone: 'text-amber-700', bg: 'bg-amber-50' }
                  : status === 'rejected'
                    ? { label: 'Changes requested', tone: 'text-danger', bg: 'bg-red-50' }
                    : { label: 'Not uploaded', tone: 'text-silver-500', bg: 'bg-silver-100' };

            return (
              <View key={r.key} className="rounded-2xl border border-silver-200 p-3">
                <View className="flex-row items-center">
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-ink-900">{r.label}</Text>
                    <Text className="text-[11px] text-silver-500 mt-0.5">{r.sub}</Text>
                  </View>
                  <View className={`px-2 py-1 rounded-full ${badge.bg}`}>
                    <Text className={`text-[11px] font-bold ${badge.tone}`}>{badge.label}</Text>
                  </View>
                </View>

                {status === 'rejected' && doc?.rejection_reason ? (
                  <View className="mt-2 rounded-xl bg-red-50 p-3">
                    <Text className="text-xs text-danger">
                      <Text className="font-bold">Movvy said: </Text>
                      {doc.rejection_reason}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => replace(r.key)}
                  disabled={busy !== null}
                  className={`mt-3 h-10 rounded-xl items-center justify-center flex-row border ${
                    status === 'approved' || status === 'pending'
                      ? 'border-silver-300 bg-white active:opacity-70'
                      : 'border-brand-600 bg-brand-600 active:opacity-90'
                  }`}
                >
                  {busy === r.key ? (
                    <ActivityIndicator color="#71717A" size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name={status === 'missing' ? 'cloud-upload-outline' : 'refresh'}
                        size={14}
                        color={status === 'approved' || status === 'pending' ? '#0A0A0A' : '#fff'}
                      />
                      <Text
                        className={`ml-2 text-xs font-bold ${
                          status === 'approved' || status === 'pending'
                            ? 'text-ink-900'
                            : 'text-white'
                        }`}
                      >
                        {status === 'missing' ? 'Upload' : 'Replace photo'}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}
