// =============================================================================
// Mover onboarding — Step 4: Documents
//
// Previously the "Upload" tiles only toggled a local boolean — nothing
// actually went to Supabase Storage. They now open the system photo / file
// picker, stash the picked file locally, and on Submit:
//   1. Create the partner_team (gets us the team_id)
//   2. Upload each staged file to the verifications bucket via the
//      documents-upload-url edge function. Profile-level docs (gov_id,
//      driver_license, selfie_with_id) go on the signed-in driver; team-
//      level docs (vehicle insurance, business registration) go on the team.
//   3. Send the mover invite.
//   4. Route to the pending screen.
//
// If a single upload fails we surface it but still continue — the owner can
// re-upload from the team profile later, the team row is already created and
// is the source of truth for review.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { useCreatePartnerTeam, useSendPartnerInvites, useUploadDocument } from '@/lib/data';
import { usePartnerStore } from '@/store/partnerStore';
import { supabase, supabaseConfigured, useAuth } from '@/lib/supabase';
import { toE164, isPhoneComplete } from '@/components/PhoneInput';

type SubjectScope = 'profile' | 'team';
type DocKind =
  | 'gov_id'
  | 'driver_license'
  | 'insurance'
  | 'business_registration'
  | 'selfie_with_id';

interface DocSpec {
  key: string;
  label: string;
  sub: string;
  kind: DocKind;
  scope: SubjectScope;
  required: boolean;
}

const DOCS: DocSpec[] = [
  { key: 'gov_id',           label: 'Government ID',         sub: 'Driver license or passport',           kind: 'gov_id',                scope: 'profile', required: true },
  { key: 'license',          label: 'Driver license',        sub: 'Valid Alberta class 5 or equivalent',  kind: 'driver_license',        scope: 'profile', required: true },
  { key: 'insurance',        label: 'Vehicle insurance',     sub: 'Commercial coverage preferred',        kind: 'insurance',             scope: 'team',    required: true },
  { key: 'business',         label: 'Business registration', sub: 'GST # if registered (optional)',       kind: 'business_registration', scope: 'team',    required: false },
  { key: 'profile_photo',    label: 'Profile photo',         sub: 'Selfie holding your ID',               kind: 'selfie_with_id',        scope: 'profile', required: true },
];

interface StagedFile {
  uri: string;
  fileName: string;
  mimeType: string;
}

export default function Documents() {
  // Staged files keyed by doc.key — only flips to "uploaded" after the real
  // PUT succeeds in submit().
  const [staged, setStaged] = useState<Record<string, StagedFile>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const allRequiredStaged = DOCS.filter((d) => d.required).every((d) => !!staged[d.key]);

  const { teamDriver, teamMover, teamCitySlug } = usePartnerStore();
  const { user } = useAuth();
  const createTeam = useCreatePartnerTeam();
  const sendInvites = useSendPartnerInvites();
  const uploadDoc = useUploadDocument();

  const pickDocument = async (key: string) => {
    // Ask for library permission first — silent denial leads to a confusing
    // no-op when the picker returns 'cancelled' with no choice ever offered.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Movvy needs photo access to upload your verification documents.',
      );
      return;
    }
    setUploadingKey(key);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      router.push('/(mover)/onboarding/pending?demo=1');
      return;
    }
    if (!user) {
      Alert.alert('Not signed in', 'Sign in again to finish onboarding.');
      return;
    }
    setSubmitting(true);
    try {
      // 1. Create the team — invite_code is auto-generated by DB trigger.
      const created = await createTeam.mutateAsync({
        citySlug: teamCitySlug || 'calgary',
        driver: {
          ...teamDriver,
          phone: isPhoneComplete(teamDriver.phone) ? toE164(teamDriver.phone) : '',
        },
        mover: {
          ...teamMover,
          phone: isPhoneComplete(teamMover.phone) ? toE164(teamMover.phone) : '',
        },
      });

      // 2. Upload every staged file. Failures are surfaced but don't block
      //    the onboarding completion — the partner can re-upload from the
      //    profile screen later.
      const uploadFailures: string[] = [];
      for (const doc of DOCS) {
        const file = staged[doc.key];
        if (!file) continue;
        try {
          await uploadDoc.mutateAsync({
            bucket: 'verifications',
            kind: doc.kind,
            subject_type: doc.scope,
            subject_id: doc.scope === 'profile' ? user.id : created.id,
            fileUri: file.uri,
            fileName: file.fileName,
            mimeType: file.mimeType,
          });
        } catch (e: any) {
          console.warn(`[mover onboarding] upload ${doc.key} failed`, e);
          uploadFailures.push(doc.label);
        }
      }

      // 3. Invite the mover (the second team member). Driver is already linked.
      if (teamMover.email.includes('@') || isPhoneComplete(teamMover.phone)) {
        try {
          await sendInvites.mutateAsync({
            team_id: created.id,
            invites: [
              {
                role: 'mover',
                full_name: teamMover.fullName,
                email: teamMover.email.includes('@') ? teamMover.email : undefined,
                phone: isPhoneComplete(teamMover.phone) ? toE164(teamMover.phone) : undefined,
              },
            ],
          });
        } catch (e) {
          console.warn('[two-man onboarding] invite dispatch failed', e);
        }
      }

      if (uploadFailures.length) {
        Alert.alert(
          'Some uploads failed',
          `Your team is registered, but these need to be re-uploaded from your profile screen:\n\n• ${uploadFailures.join('\n• ')}`,
          [
            {
              text: 'Continue',
              onPress: () =>
                router.push(
                  `/(mover)/onboarding/pending?code=${created.invite_code}&id=${created.id}`,
                ),
            },
          ],
        );
        return;
      }

      router.push(`/(mover)/onboarding/pending?code=${created.invite_code}&id=${created.id}`);
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={4} total={5} label="Documents" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text className="text-2xl font-bold text-ink-900 mt-2">Upload your documents</Text>
        <Text className="mt-1 text-sm text-silver-500">
          Movvy verifies every driver. This keeps customers safe and rates honest.
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
                  <Text className="text-base font-bold text-ink-900">
                    {d.label}
                    {!d.required ? (
                      <Text className="text-xs text-silver-500 font-normal"> · optional</Text>
                    ) : null}
                  </Text>
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
          disabled={!allRequiredStaged || submitting}
          loading={submitting || createTeam.isPending}
          onPress={submit}
        />
      </View>
    </SafeAreaView>
  );
}
