// =============================================================================
// /(company)/onboarding/operator — the single partner onboarding.
//
// New operator model (there is no company/team/driver/mover): everyone who signs
// up does the SAME thing here —
//   1. Upload driver's license + government ID
//   2. Pick your HQ city
//   3. Add the truck you drive + its size
// On finish we create the person's OWN org via create_operator_org() (they're
// the admin, they get a unique CO- code) and attach the truck. Forming a crew
// happens later from the profile portal by sharing/entering a code.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { supabase, useAuth } from '@/lib/supabase';
import { useCities, useUploadDocument } from '@/lib/data';

type DocKey = 'driver_license' | 'gov_id';
const DOCS: { key: DocKey; label: string; hint: string }[] = [
  { key: 'driver_license', label: "Driver's license", hint: 'Front, clear and readable' },
  { key: 'gov_id', label: 'Government ID', hint: 'Passport or provincial ID' },
];

const TRUCK_SIZES: { value: string; label: string }[] = [
  { value: 'cargo_van', label: 'Cargo van' },
  { value: 'cube_van_16', label: '16 ft cube van' },
  { value: 'box_truck_24', label: '24 ft box truck' },
  { value: 'box_truck_26', label: '26 ft box truck' },
  { value: 'pickup_truck', label: 'Pickup truck' },
  { value: 'other', label: 'Other' },
];

export default function OperatorOnboarding() {
  const toast = useToast();
  const { user } = useAuth();
  const { data: cities, isLoading: citiesLoading } = useCities();
  const upload = useUploadDocument();

  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({
    driver_license: false,
    gov_id: false,
  });
  const [busyDoc, setBusyDoc] = useState<DocKey | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [truckSize, setTruckSize] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [province, setProvince] = useState('AB');
  const [submitting, setSubmitting] = useState(false);

  const pickDoc = async (kind: DocKey) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error('Photo access is needed to upload your documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setBusyDoc(kind);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind,
        subject_type: 'profile',
        subject_id: user!.id,
        fileUri: asset.uri,
        fileName: asset.fileName ?? `${kind}-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      setUploaded((p) => ({ ...p, [kind]: true }));
      haptic.success();
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed — try again.');
    } finally {
      setBusyDoc(null);
    }
  };

  const canFinish =
    uploaded.driver_license &&
    uploaded.gov_id &&
    !!cityId &&
    !!truckSize &&
    plate.trim().length >= 2 &&
    province.trim().length >= 2;

  const finish = async () => {
    if (!canFinish) {
      toast.error('Upload both documents, pick your city, and add your truck first.');
      return;
    }
    setSubmitting(true);
    try {
      // Name the solo org after the operator until they form a crew and set a
      // crew name. Fall back to the auth metadata name, then a generic label.
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user!.id)
        .maybeSingle();
      const displayName =
        prof?.full_name ?? (user?.user_metadata as any)?.full_name ?? 'My crew';

      const { data: companyId, error: orgErr } = await supabase.rpc('create_operator_org', {
        p_display_name: displayName,
        p_city_id: cityId,
      });
      if (orgErr) throw orgErr;

      const { error: truckErr } = await supabase.from('vehicles').insert({
        company_id: companyId,
        type: truckSize,
        plate: plate.trim().toUpperCase(),
        province: province.trim().toUpperCase(),
      });
      // A truck hiccup shouldn't strand them out of their new org — they can add
      // it from the profile later. Surface it but continue.
      if (truckErr) console.warn('[operator onboarding] truck insert failed', truckErr);

      haptic.success();
      toast.success('You\'re all set up.');
      router.replace('/(company)/(tabs)/dashboard');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not finish setup. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader title="Set up your profile" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold text-ink-900">Let's get you road-ready</Text>
        <Text className="mt-1 text-sm text-silver-500 leading-6">
          A few things so customers can trust you and we can match the right moves
          to your truck.
        </Text>

        {/* 1. Documents */}
        <Text className="mt-7 text-xs font-semibold uppercase tracking-wider text-silver-500">
          1 · Your documents
        </Text>
        <View className="mt-3 gap-3">
          {DOCS.map((d) => (
            <Pressable
              key={d.key}
              onPress={() => pickDoc(d.key)}
              disabled={busyDoc !== null}
              className={`flex-row items-center rounded-2xl border p-4 active:opacity-80 ${
                uploaded[d.key] ? 'border-brand-200 bg-brand-50' : 'border-silver-200 bg-white'
              }`}
            >
              <View
                className={`h-11 w-11 rounded-2xl items-center justify-center ${
                  uploaded[d.key] ? 'bg-brand-600' : 'bg-silver-100'
                }`}
              >
                {busyDoc === d.key ? (
                  <ActivityIndicator color={uploaded[d.key] ? '#fff' : '#71717A'} />
                ) : (
                  <Ionicons
                    name={uploaded[d.key] ? 'checkmark' : 'camera-outline'}
                    size={20}
                    color={uploaded[d.key] ? '#fff' : '#71717A'}
                  />
                )}
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">{d.label}</Text>
                <Text className="text-xs text-silver-500 mt-0.5">
                  {uploaded[d.key] ? 'Uploaded — Movvy will review it' : d.hint}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
            </Pressable>
          ))}
        </View>

        {/* 2. HQ city */}
        <Text className="mt-8 text-xs font-semibold uppercase tracking-wider text-silver-500">
          2 · Your home city
        </Text>
        {citiesLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator color="#16A34A" />
          </View>
        ) : (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {(cities ?? []).map((c: any) => {
              const active = cityId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCityId(c.id)}
                  className={`rounded-full border px-4 py-2.5 ${
                    active ? 'border-brand-600 bg-brand-600' : 'border-silver-200 bg-white'
                  }`}
                >
                  <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-ink-900'}`}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 3. Truck */}
        <Text className="mt-8 text-xs font-semibold uppercase tracking-wider text-silver-500">
          3 · Your truck
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {TRUCK_SIZES.map((t) => {
            const active = truckSize === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setTruckSize(t.value)}
                className={`rounded-full border px-4 py-2.5 ${
                  active ? 'border-brand-600 bg-brand-600' : 'border-silver-200 bg-white'
                }`}
              >
                <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-ink-900'}`}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Input
              label="Plate"
              placeholder="ABC 123"
              value={plate}
              onChangeText={setPlate}
              autoCapitalize="characters"
            />
          </View>
          <View style={{ width: 96 }}>
            <Input
              label="Province"
              placeholder="AB"
              value={province}
              onChangeText={(t) => setProvince(t.toUpperCase().slice(0, 2))}
              autoCapitalize="characters"
              maxLength={2}
            />
          </View>
        </View>

        <View className="mt-8">
          <Button
            label="Finish setup"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canFinish}
            onPress={finish}
          />
          <Text className="mt-3 text-center text-[11px] text-silver-400 leading-4">
            You'll get your own crew code next. Share it to build a team, or enter
            someone else's code to join theirs.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
