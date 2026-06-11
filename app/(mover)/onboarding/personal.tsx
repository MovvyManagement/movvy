import React from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete } from '@/components/PhoneInput';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { usePartnerStore, type TeamMember } from '@/store/partnerStore';
import { useCities } from '@/lib/data';

// The driver is the signing-up user — needs BOTH email AND phone (their
// account uses these, plus customers may call/text via Movvy proxy).
// The mover is the INVITEE — needs name + at least one of email|phone
// (whichever the driver has) so we can text/email them the invite.
function isDriverValid(m: TeamMember) {
  return (
    m.fullName.trim().length > 1 &&
    m.email.includes('@') &&
    isPhoneComplete(m.phone) &&
    (m.licenseNumber ?? '').trim().length >= 4
  );
}

function isMoverInviteValid(m: TeamMember) {
  return (
    m.fullName.trim().length > 1 &&
    (m.email.includes('@') || isPhoneComplete(m.phone))
  );
}

export default function PersonalInfo() {
  const { teamDriver, teamMover, setTeamDriver, setTeamMover, teamCitySlug, setTeamCitySlug } =
    usePartnerStore();
  const { data: cities } = useCities();

  const driverOk = isDriverValid(teamDriver);
  const moverOk = isMoverInviteValid(teamMover);
  // The team can't be created without a city — that's the field the
  // job feed filters on. Block Continue until one is selected.
  const cityOk = !!teamCitySlug;
  const ready = driverOk && moverOk && cityOk;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScreenHeader />
        <StepIndicator step={2} total={5} label="Your team" />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-2xl font-bold text-ink-900 mt-2">Build your 2-person crew</Text>
          <Text className="mt-1 text-sm text-silver-500 leading-5">
            Movvy partners work in pairs — one driver and one mover — so customers always get a
            crew that can handle the truck and the lift.
          </Text>

          {/* Requirement banner */}
          <View className="mt-4 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row">
            <Ionicons name="people" size={20} color="#047857" />
            <View className="ml-2 flex-1">
              <Text className="text-sm font-bold text-ink-900">Minimum 2 people required</Text>
              <Text className="text-xs text-silver-600 mt-0.5 leading-5">
                Both team members must complete verification before either of you can accept jobs.
              </Text>
            </View>
          </View>

          {/* CITY PICKER — determines which market the team's job feed
              scopes to. Pulled from the cities table so the list stays in
              sync as Movvy expands province-wide. */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
            Where will your crew operate?
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {(cities ?? []).map((c) => (
              <Chip
                key={c.slug}
                label={c.name}
                selected={teamCitySlug === c.slug}
                onPress={() => setTeamCitySlug(c.slug)}
              />
            ))}
          </ScrollView>

          {/* DRIVER */}
          <View className="mt-6 flex-row items-center">
            <View className="h-9 w-9 rounded-full bg-ink-900 items-center justify-center">
              <Ionicons name="car-sport" size={18} color="#fff" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">Driver (you)</Text>
              <Text className="text-xs text-silver-500">
                Drives the vehicle · holds valid license
              </Text>
            </View>
            {driverOk ? (
              <Ionicons name="checkmark-circle" size={22} color="#047857" />
            ) : (
              <View className="h-5 w-5 rounded-full border-2 border-silver-300" />
            )}
          </View>

          <Text className="mt-2 text-xs text-silver-500 leading-5">
            Both email and phone are required — your account uses one for sign-in
            and the other for customer proxy contact during a move.
          </Text>

          <View className="mt-3 gap-3">
            <Input
              label="Full legal name"
              placeholder="As it appears on driver license"
              value={teamDriver.fullName}
              onChangeText={(t) => setTeamDriver({ fullName: t })}
              leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
            />
            <Input
              label="Email (required)"
              placeholder="driver@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={teamDriver.email}
              onChangeText={(t) => setTeamDriver({ email: t })}
              leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
            />
            <PhoneInput
              label="Phone (required)"
              value={teamDriver.phone}
              onChangeText={(t) => setTeamDriver({ phone: t })}
            />
            <Input
              label="Driver license number"
              placeholder="Alberta class 5 or equivalent"
              autoCapitalize="characters"
              value={teamDriver.licenseNumber}
              onChangeText={(t) => setTeamDriver({ licenseNumber: t })}
              leftIcon={<Ionicons name="card-outline" size={18} color="#71717A" />}
            />
          </View>

          {/* MOVER */}
          <View className="mt-8 flex-row items-center">
            <View className="h-9 w-9 rounded-full bg-brand-600 items-center justify-center">
              <Ionicons name="barbell" size={18} color="#fff" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">Mover (your crew)</Text>
              <Text className="text-xs text-silver-500">Handles the lift, carry, and load-in</Text>
            </View>
            {moverOk ? (
              <Ionicons name="checkmark-circle" size={22} color="#047857" />
            ) : (
              <View className="h-5 w-5 rounded-full border-2 border-silver-300" />
            )}
          </View>

          <View className="mt-2 rounded-2xl bg-silver-50 p-3 flex-row items-start">
            <Ionicons name="paper-plane-outline" size={16} color="#047857" />
            <Text className="ml-2 flex-1 text-xs text-silver-600 leading-5">
              We'll text them (or email, if no phone) the moment you finish
              onboarding. They'll get a unique team code to download Movvy and
              join your crew — no one else can sign up against your team.
            </Text>
          </View>

          <View className="mt-3 gap-3">
            <Input
              label="Full legal name"
              placeholder="As it appears on government ID"
              value={teamMover.fullName}
              onChangeText={(t) => setTeamMover({ fullName: t })}
              leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
            />
            <Input
              label="Email (or phone)"
              placeholder="mover@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={teamMover.email}
              onChangeText={(t) => setTeamMover({ email: t })}
              hint="Provide at least one — SMS preferred"
              leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
            />
            <PhoneInput
              label="Phone (or email)"
              value={teamMover.phone}
              onChangeText={(t) => setTeamMover({ phone: t })}
              hint="SMS gets opened faster"
            />
          </View>

          {/* Status summary */}
          <View className="mt-6 rounded-2xl bg-silver-50 p-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              Team status
            </Text>
            <View className="flex-row gap-3">
              <View className="flex-1 flex-row items-center">
                <Ionicons
                  name={driverOk ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={driverOk ? '#047857' : '#A1A1AA'}
                />
                <Text className={`ml-1.5 text-xs font-semibold ${driverOk ? 'text-brand-700' : 'text-silver-500'}`}>
                  Driver
                </Text>
              </View>
              <View className="flex-1 flex-row items-center">
                <Ionicons
                  name={moverOk ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={moverOk ? '#047857' : '#A1A1AA'}
                />
                <Text className={`ml-1.5 text-xs font-semibold ${moverOk ? 'text-brand-700' : 'text-silver-500'}`}>
                  Mover
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
          <Button
            label={ready ? 'Continue' : 'Complete both members to continue'}
            size="lg"
            fullWidth
            disabled={!ready}
            onPress={() => router.push('/(mover)/onboarding/vehicle')}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
