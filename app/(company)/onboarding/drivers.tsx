import React from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete } from '@/components/PhoneInput';
import { Button } from '@/components/Button';
import { Counter } from '@/components/Counter';
import { usePartnerStore, type CompanyDriver } from '@/store/partnerStore';

// Each driver is INVITED — they create their own account via the partner-join
// flow using the company's invite code. So we only need: name, license, and
// at least one of email|phone to send them the invite (SMS preferred).
function isDriverComplete(d: CompanyDriver) {
  return (
    d.fullName.trim().length > 1 &&
    d.licenseNumber.trim().length >= 4 &&
    (isPhoneComplete(d.phone) || d.email.includes('@'))
  );
}

export default function CompanyDrivers() {
  const { company, setDriverCount, upsertDriver } = usePartnerStore();
  const drivers = company.drivers;
  const completeCount = drivers.filter(isDriverComplete).length;
  const allComplete = completeCount === drivers.length && drivers.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader />
        <StepIndicator step={3} total={5} label="Your drivers" />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-2xl font-bold text-ink-900 mt-2">Roster your drivers</Text>
          <Text className="mt-1 text-sm text-silver-500 leading-5">
            Every driver under your company must be entered here. They'll be verified by Movvy
            before they can accept jobs.
          </Text>

          {/* Count summary */}
          <View className="mt-5 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row items-center">
            <Ionicons name="people" size={20} color="#047857" />
            <View className="ml-2 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                {completeCount} of {drivers.length} drivers complete
              </Text>
              <Text className="text-xs text-silver-600 mt-0.5">
                Fill every field for each driver to continue.
              </Text>
            </View>
          </View>

          {/* Adjust driver count inline if needed */}
          <View className="mt-4 rounded-3xl border border-silver-200 px-5">
            <Counter
              label="Number of drivers"
              sub="Add or remove rosters below"
              value={drivers.length}
              onChange={(n) => setDriverCount(n)}
              min={1}
              max={50}
            />
          </View>

          {/* One card per driver */}
          {drivers.map((d, idx) => {
            const ok = isDriverComplete(d);
            return (
              <View
                key={d.id}
                className={`mt-4 rounded-3xl border p-5 ${
                  ok ? 'border-brand-200 bg-brand-50/40' : 'border-silver-200 bg-white'
                }`}
              >
                <View className="flex-row items-center mb-3">
                  <View
                    className={`h-9 w-9 rounded-full items-center justify-center ${
                      ok ? 'bg-brand-600' : 'bg-silver-200'
                    }`}
                  >
                    <Text className={`text-sm font-bold ${ok ? 'text-white' : 'text-ink-700'}`}>
                      {idx + 1}
                    </Text>
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-base font-bold text-ink-900">
                      Driver {idx + 1}
                      {d.fullName ? ` · ${d.fullName.split(' ')[0]}` : ''}
                    </Text>
                    <Text className="text-xs text-silver-500">
                      Required: name, license #, and email OR phone for the invite
                    </Text>
                  </View>
                  {ok ? (
                    <Ionicons name="checkmark-circle" size={20} color="#047857" />
                  ) : null}
                </View>

                <View className="gap-3">
                  <Input
                    label="Full legal name"
                    placeholder="As it appears on driver license"
                    value={d.fullName}
                    onChangeText={(t) => upsertDriver(d.id, { fullName: t })}
                    leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
                  />
                  <Input
                    label="Driver license number"
                    placeholder="AB class 5 or equivalent"
                    autoCapitalize="characters"
                    value={d.licenseNumber}
                    onChangeText={(t) => upsertDriver(d.id, { licenseNumber: t })}
                    leftIcon={<Ionicons name="card-outline" size={18} color="#71717A" />}
                  />
                  <PhoneInput
                    label="Phone (or email)"
                    value={d.phone}
                    onChangeText={(t) => upsertDriver(d.id, { phone: t })}
                    hint="SMS invite preferred — opens fastest"
                  />
                  <Input
                    label="Email (or phone)"
                    placeholder="driver@company.ca"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={d.email}
                    onChangeText={(t) => upsertDriver(d.id, { email: t })}
                    leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
                  />
                  <Input
                    label="Vehicle assigned (optional)"
                    placeholder="e.g. 26ft box truck — ABC 4421"
                    value={d.vehicleAssigned ?? ''}
                    onChangeText={(t) => upsertDriver(d.id, { vehicleAssigned: t })}
                    leftIcon={<Ionicons name="car-outline" size={18} color="#71717A" />}
                  />
                </View>
              </View>
            );
          })}

          <View className="mt-6 rounded-2xl bg-silver-50 p-4 flex-row">
            <Ionicons name="paper-plane-outline" size={18} color="#047857" />
            <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
              As soon as you finish onboarding, each driver gets a text (or
              email) with your company's unique invite code and a download
              link. They sign up using that code — no one outside your roster
              can claim to be your driver.
            </Text>
          </View>
        </ScrollView>

        <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
          <Button
            label={
              allComplete
                ? 'Continue'
                : `Complete ${drivers.length - completeCount} more driver${drivers.length - completeCount === 1 ? '' : 's'}`
            }
            size="lg"
            fullWidth
            disabled={!allComplete}
            onPress={() => router.push('/(company)/onboarding/documents')}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
