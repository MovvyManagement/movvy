// =============================================================================
// Company onboarding — Step 4: Documents
//
// All four required company documents are uploaded after the company row is
// created (we need its UUID to scope storage paths + verification_documents
// rows). Each tile opens the image picker, stashes the file locally, and
// real PUTs happen in submit():
//   1. Create the company → invite_code + id come back
//   2. PUT each staged file via the documents-upload-url edge fn with
//      subject_type='company' + subject_id=created.id
//   3. Dispatch driver invites
//   4. Route to the share / pending screen
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { useCreateCompany, useSendPartnerInvites, useUploadDocument } from '@/lib/data';
import { usePartnerStore } from '@/store/partnerStore';
import { toE164, isPhoneComplete } from '@/components/PhoneInput';
import { supabaseConfigured } from '@/lib/supabase';

type DocKind =
  | 'business_registration'
  | 'insurance'
  | 'wcb'
  | 'fleet_insurance';

interface DocSpec {
  key: string;
  label: string;
  sub: string;
  kind: DocKind;
}

const DOCS: DocSpec[] = [
  { key: 'business_license',    label: 'Business license',     sub: 'Provincial or municipal',  kind: 'business_registration' },
  { key: 'liability_insurance', label: 'Liability insurance',  sub: 'Min $2M coverage',         kind: 'insurance' },
  { key: 'wcb',                 label: "Worker's compensation", sub: 'WCB Alberta or equivalent', kind: 'wcb' },
  { key: 'fleet_insurance',     label: 'Fleet insurance',      sub: 'Commercial coverage',      kind: 'fleet_insurance' },
];

interface StagedFile {
  uri: string;
  fileName: string;
  mimeType: string;
}

export default function CompanyDocuments() {
  const [staged, setStaged] = useState<Record<string, StagedFile>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const allStaged = DOCS.every((d) => !!staged[d.key]);
  const { company } = usePartnerStore();
  const createCompany = useCreateCompany();
  const sendInvites = useSendPartnerInvites();
  const uploadDoc = useUploadDocument();

  const pickDocument = async (key: string) => {
    // iOS runs the picker out of process and needs no permission — asking for
    // one opens the "Selected Photos" management sheet instead, which has no
    // way to submit anything (see src/lib/pickPhoto.ts).
    if (Platform.OS === 'android') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Movvy needs photo access to upload your verification documents.',
        );
        return;
      }
    }
    setUploadingKey(key);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        exif: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const fileName = asset.fileName ?? `${key}-${Date.now()}.jpg`;
      const mimeType = asset.mimeType ?? 'image/jpeg';
      setStaged((s) => ({
        ...s,
        [key]: { uri: asset.uri, fileName, mimeType },
      }));
    } catch (e: any) {
      Alert.alert("Couldn't select file", e?.message ?? 'Try again.');
    } finally {
      setUploadingKey(null);
    }
  };

  const removeStaged = (key: string) =>
    setStaged((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });

  const submit = async () => {
    if (!supabaseConfigured) {
      router.push('/(company)/onboarding/pending?demo=1');
      return;
    }
    setSubmitting(true);
    try {
      // Slug-ify the captured HQ city ('Red Deer' → 'red-deer'). The server
      // re-validates against `cities` and snaps to the closest active city
      // by lat/lng if the slug is unknown, so a typo won't kill the signup.
      const slug =
        (company.city || 'Calgary').trim().toLowerCase().replace(/\s+/g, '-') ||
        'calgary';
      // 1. Create the company row.
      const created = await createCompany.mutateAsync({
        legal_name: company.companyName,
        display_name: company.companyName,
        registration_number: company.registration,
        phone: toE164(company.phone),
        email: company.email,
        citySlug: slug,
        hq: {
          line1: company.hqAddress,
          city: company.city,
          region: 'AB',
          country_code: 'CA',
          lat: company.hqLat ?? 0,
          lng: company.hqLng ?? 0,
        },
        truck_count: company.truckCount,
        drivers: company.drivers.map((d) => ({
          ...d,
          phone: isPhoneComplete(d.phone) ? toE164(d.phone) : '',
        })),
      });

      // 2. Upload staged files to the verifications bucket scoped to the
      //    new company UUID. Failures are non-fatal — the owner can re-upload
      //    from the company profile screen.
      const uploadFailures: string[] = [];
      for (const doc of DOCS) {
        const file = staged[doc.key];
        if (!file) continue;
        try {
          await uploadDoc.mutateAsync({
            bucket: 'verifications',
            kind: doc.kind,
            subject_type: 'company',
            subject_id: created.id,
            fileUri: file.uri,
            fileName: file.fileName,
            mimeType: file.mimeType,
          });
        } catch (e) {
          console.warn(`[company onboarding] upload ${doc.key} failed`, e);
          uploadFailures.push(doc.label);
        }
      }

      // 3. Dispatch driver invites — SMS preferred, email fallback.
      const inviteable = company.drivers
        .filter((d) => isPhoneComplete(d.phone) || d.email.includes('@'))
        .map((d) => ({
          role: 'driver' as const,
          full_name: d.fullName,
          email: d.email.includes('@') ? d.email : undefined,
          phone: isPhoneComplete(d.phone) ? toE164(d.phone) : undefined,
        }));

      if (inviteable.length > 0) {
        try {
          await sendInvites.mutateAsync({
            company_id: created.id,
            invites: inviteable,
          });
        } catch (e) {
          console.warn('[company onboarding] invite dispatch failed', e);
        }
      }

      if (uploadFailures.length) {
        Alert.alert(
          'Some uploads failed',
          `Your company is registered, but these need to be re-uploaded from the company profile:\n\n• ${uploadFailures.join('\n• ')}`,
          [
            {
              text: 'Continue',
              onPress: () =>
                router.push(
                  `/(company)/onboarding/pending?code=${created.invite_code}&id=${created.id}`,
                ),
            },
          ],
        );
        return;
      }

      router.push(`/(company)/onboarding/pending?code=${created.invite_code}&id=${created.id}`);
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={4} total={5} label="Verification" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text className="text-2xl font-bold text-ink-900 mt-2">Upload your documents</Text>
        <Text className="mt-1 text-sm text-silver-500">
          We verify every company so customers can trust the platform.
        </Text>

        <View className="mt-6 gap-3">
          {DOCS.map((d) => {
            const file = staged[d.key];
            const done = !!file;
            const busy = uploadingKey === d.key;
            return (
              <Pressable
                key={d.key}
                onPress={() => (done ? removeStaged(d.key) : pickDocument(d.key))}
                disabled={busy || submitting}
                className={`flex-row items-center rounded-3xl border p-4 active:opacity-80 ${
                  done ? 'border-brand-600 bg-brand-50' : 'border-silver-200'
                }`}
                accessibilityRole="button"
                accessibilityLabel={`${done ? 'Replace' : 'Upload'} ${d.label}`}
              >
                <View
                  className={`h-12 w-12 rounded-2xl items-center justify-center ${
                    done ? 'bg-brand-600' : 'bg-silver-100'
                  }`}
                >
                  {busy ? (
                    <ActivityIndicator color="#0A0A0A" />
                  ) : (
                    <Ionicons
                      name={done ? 'checkmark' : 'cloud-upload-outline'}
                      size={20}
                      color={done ? '#fff' : '#0A0A0A'}
                    />
                  )}
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-base font-bold text-ink-900">{d.label}</Text>
                  <Text className="text-xs text-silver-500 mt-0.5">
                    {done ? file.fileName : d.sub}
                  </Text>
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    done ? 'text-brand-700' : 'text-silver-500'
                  }`}
                >
                  {done ? 'Selected' : 'Upload'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row">
          <Ionicons name="lock-closed-outline" size={18} color="#71717A" />
          <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
            Files are uploaded over a signed URL straight to encrypted storage.
            Only Movvy admins reviewing your application can open them.
          </Text>
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button
          label={submitting ? 'Submitting…' : 'Submit for review'}
          size="lg"
          fullWidth
          disabled={!allStaged || submitting}
          loading={submitting || createCompany.isPending}
          onPress={submit}
        />
      </View>
    </SafeAreaView>
  );
}
