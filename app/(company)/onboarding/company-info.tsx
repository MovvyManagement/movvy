import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Input } from '@/components/Input';
import { PhoneInput, isPhoneComplete } from '@/components/PhoneInput';
import { Counter } from '@/components/Counter';
import { Button } from '@/components/Button';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { LiveMap } from '@/components/LiveMap';
import { usePartnerStore } from '@/store/partnerStore';
import type { GeocodeResult } from '@/lib/geocoding';

export default function CompanyInfo() {
  const { company, setCompany, setDriverCount } = usePartnerStore();
  const [hqText, setHqText] = useState(company.hqAddress);
  const [hqGeo, setHqGeo] = useState<GeocodeResult | null>(
    company.hqLat && company.hqLng
      ? ({
          id: 'prefill',
          label: company.hqAddress,
          secondary: company.city,
          lat: company.hqLat,
          lng: company.hqLng,
          raw: {},
        } as GeocodeResult)
      : null
  );

  // Company needs name + registration + BOTH email AND phone + a geocoded HQ.
  // Email/phone are how Movvy admin reaches you for verification + payouts,
  // and how your customers contact dispatch via the Movvy proxy line.
  const ready =
    company.companyName.trim().length > 1 &&
    company.registration.trim().length > 3 &&
    company.email.includes('@') &&
    isPhoneComplete(company.phone) &&
    !!hqGeo;

  const next = () => {
    // Pull the city name out of the geocode payload so the company is
    // registered against the right market. Nominatim returns it under
    // `address.city` / `town` / `village`; Google's structured_formatting
    // is exposed via `secondary`. Falls back to whatever was already in
    // the store (defaults to 'Calgary') so we never write null.
    const raw: any = (hqGeo as any)?.raw ?? {};
    const addr = raw.address ?? {};
    const detectedCity =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      // Google secondary text looks like "Calgary, AB, Canada" — first segment is the city.
      (hqGeo!.secondary ? hqGeo!.secondary.split(',')[0]?.trim() : '') ||
      company.city;
    setCompany({
      hqAddress: hqGeo!.label,
      hqLat: hqGeo!.lat,
      hqLng: hqGeo!.lng,
      city: detectedCity,
    });
    router.push('/(company)/onboarding/drivers');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader />
        <StepIndicator step={2} total={5} label="Company info" />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-2xl font-bold text-ink-900 mt-2">List your moving company</Text>
          <Text className="mt-1 text-sm text-silver-500">
            Get matched with customers in your area. Movvy keeps 17%.
          </Text>

          <View className="mt-6 gap-4">
            <Input
              label="Company name"
              placeholder="e.g. Trailwest Moving Co."
              value={company.companyName}
              onChangeText={(t) => setCompany({ companyName: t })}
              leftIcon={<Ionicons name="business-outline" size={18} color="#71717A" />}
            />
            <Input
              label="Business registration #"
              placeholder="GST/HST or business #"
              value={company.registration}
              onChangeText={(t) => setCompany({ registration: t })}
              leftIcon={<Ionicons name="document-text-outline" size={18} color="#71717A" />}
            />
            <Input
              label="Company email (required)"
              placeholder="dispatch@yourcompany.ca"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={company.email}
              onChangeText={(t) => setCompany({ email: t })}
              hint="Verification + payout notices · also used for the Movvy admin to reach you"
              leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
            />
            <PhoneInput
              label="Phone (required)"
              value={company.phone}
              onChangeText={(t) => setCompany({ phone: t })}
              hint="Routed through a Movvy proxy line — your real number stays private"
            />
          </View>

          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
            Fleet HQ / company address
          </Text>
          <Text className="text-xs text-silver-500 mb-3 leading-5">
            Where your fleet is dispatched from. We use this to match you with nearby jobs.
          </Text>
          <AddressAutocomplete
            placeholder="Enter address"
            value={hqText}
            onChangeText={(t) => {
              setHqText(t);
              if (hqGeo && t !== hqGeo.label) setHqGeo(null);
            }}
            onSelect={(r) => setHqGeo(r)}
            leftDotColor="#16A34A"
          />

          {hqGeo ? (
            <View className="mt-4">
              <LiveMap
                height={170}
                pickup={{ lat: hqGeo.lat, lng: hqGeo.lng, label: hqGeo.label }}
                caption={`HQ · ${hqGeo.label}`}
              />
            </View>
          ) : null}

          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-1">
            Fleet size
          </Text>
          <View className="rounded-3xl border border-silver-200 px-5">
            <Counter
              label="Drivers"
              sub="You'll add each driver's info on the next step"
              value={company.driverCount}
              onChange={(n) => setDriverCount(n)}
              min={1}
              max={50}
            />
            <Counter
              label="Trucks"
              value={company.truckCount}
              onChange={(n) => setCompany({ truckCount: n })}
              min={1}
              max={30}
            />
          </View>
        </ScrollView>
        <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
          <Button
            label={ready ? 'Continue' : 'Fill required fields to continue'}
            size="lg"
            fullWidth
            disabled={!ready}
            onPress={next}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
