// =============================================================================
// TruckDocsRows — registration + insurance for ONE truck, rendered inside that
// truck's card.
//
// Replaces the single company-wide "Documents" box that sat above the fleet
// list. That box was honest about nothing: it showed one registration and one
// insurance policy no matter how many trucks the crew ran, and a partner
// looking at three trucks and one "Approved" badge had no way to tell which
// vehicle it covered. Registration names a plate and insurance names a vehicle,
// so the paperwork belongs with the truck it describes.
//
// Documents attach to the vehicle (0116). A crew approved before that migration
// has company-level documents and no per-truck ones; those still count, and are
// labelled so the partner knows to replace them per truck when they next expire.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { pickPhoto } from '@/lib/pickPhoto';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { useUploadDocument, type FleetDocRow } from '@/lib/data';

type Kind = 'vehicle_registration' | 'insurance';

const ROWS: { key: Kind; label: string; sub: string }[] = [
  {
    key: 'vehicle_registration',
    label: 'Registration',
    sub: 'Required — this truck can take jobs once approved',
  },
  { key: 'insurance', label: 'Insurance', sub: 'Commercial auto policy' },
];

function badgeFor(status: string | null) {
  switch (status) {
    case 'approved':
      return { label: 'Approved', tone: 'text-brand-700', bg: 'bg-brand-50' };
    case 'pending':
      return { label: 'In review', tone: 'text-amber-700', bg: 'bg-amber-50' };
    case 'rejected':
      return { label: 'Changes requested', tone: 'text-danger', bg: 'bg-red-50' };
    default:
      return { label: 'Not uploaded', tone: 'text-silver-500', bg: 'bg-silver-100' };
  }
}

export function TruckDocsRows({
  truck,
  canEdit,
}: {
  truck: FleetDocRow;
  canEdit: boolean;
}) {
  const upload = useUploadDocument();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Kind | null>(null);

  const replace = async (kind: Kind) => {
    const file = await pickPhoto(kind, 'Upload document');
    if (!file) return;
    setBusy(kind);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind,
        // Attach to THIS truck, not the company — that's the whole point.
        subject_type: 'vehicle',
        subject_id: truck.vehicle_id,
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mime,
      });
      qc.invalidateQueries({ queryKey: ['fleet-documents'] });
      qc.invalidateQueries({ queryKey: ['fleet-readiness'] });
      haptic.success();
      toast.success('Sent to Movvy for review');
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="mt-3 gap-2">
      {ROWS.map((r) => {
        const status =
          r.key === 'insurance' ? truck.insurance_status : truck.registration_status;
        const rejection =
          r.key === 'insurance' ? truck.insurance_rejection : truck.registration_rejection;
        const isLegacy =
          r.key === 'insurance' ? truck.insurance_is_legacy : truck.registration_is_legacy;
        const badge = badgeFor(status);

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

            {isLegacy && status ? (
              // Say why a truck nobody uploaded for still shows Approved —
              // otherwise the badge looks like a bug on a brand-new truck.
              <Text className="mt-2 text-[11px] text-silver-500 leading-4">
                Covered by your crew&apos;s original paperwork. Upload this truck&apos;s own
                document when you get a chance.
              </Text>
            ) : null}

            {status === 'rejected' && rejection ? (
              <View className="mt-2 rounded-xl bg-red-50 p-3">
                <Text className="text-xs text-danger">
                  <Text className="font-bold">Movvy said: </Text>
                  {rejection}
                </Text>
              </View>
            ) : null}

            {canEdit ? (
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
                  <ActivityIndicator color={status === 'approved' ? '#0A0A0A' : '#fff'} />
                ) : (
                  <>
                    <Ionicons
                      name={status ? 'refresh' : 'cloud-upload-outline'}
                      size={15}
                      color={status === 'approved' || status === 'pending' ? '#0A0A0A' : '#fff'}
                    />
                    <Text
                      className={`ml-1.5 text-xs font-bold ${
                        status === 'approved' || status === 'pending'
                          ? 'text-ink-900'
                          : 'text-white'
                      }`}
                    >
                      {status ? 'Replace photo' : `Upload ${r.label.toLowerCase()}`}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
