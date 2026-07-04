// =============================================================================
// /(mover)/onboarding/personal — Step 2 of 5 · Your team
//
// The driver (operator) ALREADY entered their name, email, phone, and
// password — and verified the phone via SMS OTP — on the previous screen
// (/partner.tsx). So this screen no longer asks for the driver's info.
// It collects:
//   1. Operating city (slugged via the cities table)
//   2. HQ / base address (autocomplete-bound to Alberta) — travel time
//      on every booking is billed from this point, mirroring how a
//      moving company's HQ is captured.
//   3. The MOVER's contact info — name + email and/or phone. This person
//      gets the SMS / email invite to download Movvy + join the crew.
//
// On mount we pre-fill the teamDriver state from the signed-in profile
// so downstream code (documents.tsx → useCreatePartnerTeam) still has
// the driver record when it creates the partner_teams row.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete } from '@/components/PhoneInput';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { usePartnerStore, type TeamMember } from '@/store/partnerStore';
import { useCities, useProfile } from '@/lib/data';
import type { GeocodeResult } from '@/lib/geocoding';

function isMoverInviteValid(m: TeamMember) {
  // Both email AND phone are mandatory now — the mover needs the email
  // confirmation flow + the SMS proxy line for customer contact during
  // moves, same standard the driver was held to at signup.
  return (
    m.fullName.trim().length > 1 &&
    m.email.includes('@') &&
    isPhoneComplete(m.phone)
  );
}

export default function PersonalInfo() {
  const {
    teamMover,
    setTeamMover,
    teamCitySlug,
    setTeamCitySlug,
    teamHqAddress,
    teamHqLat,
    teamHqLng,
    setTeamHq,
    setTeamDriver,
  } = usePartnerStore();
  const { data: cities } = useCities();
  const { data: profile } = useProfile();

  // Pre-fill teamDriver from the signed-in user's profile so the data
  // pipeline downstream (useCreatePartnerTeam) still has a complete
  // driver record. This is invisible to the operator — they don't see
  // their own fields on this screen.
  useEffect(() => {
    if (!profile) return;
    setTeamDriver({
      fullName: profile.full_name ?? '',
      email: profile.email ?? '',
      phone: profile.phone ?? '',
    });
  }, [profile?.full_name, profile?.email, profile?.phone, setTeamDriver]);

  // ─── HQ autocomplete local state ─────────────────────────────────────────
  const [hqText, setHqText] = useState(teamHqAddress);
  const [hqGeo, setHqGeo] = useState<GeocodeResult | null>(
    teamHqAddress && teamHqLat != null && teamHqLng != null
      ? ({
          id: 'restored',
          label: teamHqAddress,
          lat: teamHqLat,
          lng: teamHqLng,
        } as GeocodeResult)
      : null,
  );

  const moverOk = isMoverInviteValid(teamMover);
  const cityOk = !!teamCitySlug;
  const hqOk = !!hqGeo;
  const ready = moverOk && cityOk && hqOk;

  const onContinue = () => {
    if (!ready || !hqGeo) return;
    setTeamHq({
      address: hqGeo.label,
      lat: hqGeo.lat,
      lng: hqGeo.lng,
    });
    router.push('/(mover)/onboarding/vehicle');
  };

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
          <Text className="text-2xl font-bold text-ink-900 mt-2">
            Add your crew + base
          </Text>
          <Text className="mt-1 text-sm text-silver-500 leading-5">
            We already have your driver details from sign-up. Tell us where
            you'll operate from and who your second crew member is.
          </Text>

          {/* Requirement banner */}
          <View className="mt-4 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row">
            <Ionicons name="people" size={20} color="#047857" />
            <View className="ml-2 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                Minimum 2 people required
              </Text>
              <Text className="text-xs text-silver-600 mt-0.5 leading-5">
                Both team members must complete verification before you can
                accept jobs. Your mover gets a unique invite to download
                Movvy and join your crew.
              </Text>
            </View>
          </View>

          {/* CITY PICKER */}
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

          {/* HQ ADDRESS — billed-from point on every booking */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
            Your base / HQ address
          </Text>
          <AddressAutocomplete
            placeholder="Start typing your operating address"
            value={hqText}
            onChangeText={(t) => {
              setHqText(t);
              if (hqGeo && t !== hqGeo.label) setHqGeo(null);
            }}
            onSelect={(r) => {
              setHqGeo(r);
              setHqText(r.label);
            }}
            leftDotColor="#0A0A0A"
          />
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            Travel time on every booking is billed from this address. Use the
            address you'll actually leave from in the morning — your shop, your
            garage, or your home if you're truly mobile.
          </Text>

          {/* MOVER (invitee) */}
          <View className="mt-8 flex-row items-center">
            <View className="h-9 w-9 rounded-full bg-brand-600 items-center justify-center">
              <Ionicons name="barbell" size={18} color="#fff" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">
                Mover (your crew)
              </Text>
              <Text className="text-xs text-silver-500">
                Handles the lift, carry, and load-in
              </Text>
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
              We'll text + email them the moment you finish onboarding. They'll
              get a unique team code to download Movvy and join your crew — no
              one else can sign up against your team.
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
              label="Email (required)"
              placeholder="mover@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={teamMover.email}
              onChangeText={(t) => setTeamMover({ email: t })}
              hint="Used for invite + account login"
              leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
            />
            <PhoneInput
              label="Phone (required)"
              value={teamMover.phone}
              onChangeText={(t) => setTeamMover({ phone: t })}
              hint="Used for SMS invite + customer proxy contact during moves"
            />
          </View>
        </ScrollView>

        <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
          <Button
            label="Continue"
            size="lg"
            fullWidth
            disabled={!ready}
            onPress={onContinue}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
