import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { usePartnerStore } from '@/store/partnerStore';

const vehicleTypes = [
  { key: 'cargo_van', label: 'Cargo van', sub: 'Up to 250 cu ft' },
  { key: 'cube_van_16', label: '16ft cube van', sub: 'Studio to 1-bed' },
  { key: 'box_truck_24', label: '24ft box truck', sub: '2-3 bed homes' },
  { key: 'box_truck_26', label: '26ft box truck', sub: '3-5 bed homes' },
];

export default function VehicleInfo() {
  // Driver's license number used to live on the "Your team" step. Now that
  // step only collects the mover's info + HQ address, the license question
  // belongs here — it's about driving credentials, same context as the
  // vehicle being driven. We push it into the partner store so
  // useCreatePartnerTeam (in documents.tsx) still picks it up.
  const teamDriver = usePartnerStore((s) => s.teamDriver);
  const setTeamDriver = usePartnerStore((s) => s.setTeamDriver);

  const [type, setType] = useState<string>('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');

  const licenseOk = (teamDriver.licenseNumber ?? '').trim().length >= 4;
  const canContinue = !!type && licenseOk;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={3} total={5} label="Your vehicle" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text className="text-2xl font-bold text-ink-900 mt-2">What do you drive?</Text>
        <Text className="mt-1 text-sm text-silver-500">
          Pick the vehicle you'll use for moves.
        </Text>

        <View className="mt-6 gap-3">
          {vehicleTypes.map((v) => {
            const sel = type === v.key;
            return (
              <Pressable
                key={v.key}
                onPress={() => setType(v.key)}
                className={`flex-row items-center rounded-3xl border p-5 active:opacity-80 ${
                  sel ? 'border-brand-600 bg-brand-50' : 'border-silver-200'
                }`}
              >
                <View className={`h-12 w-12 rounded-2xl items-center justify-center ${sel ? 'bg-brand-600' : 'bg-silver-100'}`}>
                  <Ionicons name="car-outline" size={22} color={sel ? '#fff' : '#0A0A0A'} />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-base font-bold text-ink-900">{v.label}</Text>
                  <Text className="text-xs text-silver-500 mt-0.5">{v.sub}</Text>
                </View>
                {sel ? (
                  <Ionicons name="checkmark-circle" size={22} color="#047857" />
                ) : (
                  <View className="h-5 w-5 rounded-full border-2 border-silver-300" />
                )}
              </Pressable>
            );
          })}
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-3">
          Registration
        </Text>
        <View className="gap-4">
          <Input
            label="Year & model"
            placeholder="e.g. 2022 Ford E-450"
            value={year}
            onChangeText={setYear}
            leftIcon={<Ionicons name="calendar-outline" size={18} color="#71717A" />}
          />
          <Input
            label="License plate"
            placeholder="ABC 1234"
            autoCapitalize="characters"
            value={plate}
            onChangeText={setPlate}
            leftIcon={<Ionicons name="pricetag-outline" size={18} color="#71717A" />}
          />
          <Input
            label="Driver license number"
            placeholder="Alberta class 5 or equivalent"
            autoCapitalize="characters"
            autoCorrect={false}
            value={teamDriver.licenseNumber}
            onChangeText={(t) => setTeamDriver({ licenseNumber: t })}
            leftIcon={<Ionicons name="card-outline" size={18} color="#71717A" />}
            hint="Movvy verifies this against the photo in your Documents step."
          />
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button
          label="Continue"
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={() => router.push('/(mover)/onboarding/documents')}
        />
      </View>
    </SafeAreaView>
  );
}
