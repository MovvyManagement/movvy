import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { LiveMap } from '@/components/LiveMap';
import { useBookingStore } from '@/store/bookingStore';
import type { Address } from '@/types';
import type { GeocodeResult } from '@/lib/geocoding';

function toAddress(r: GeocodeResult): Address {
  return {
    label: '',
    line1: r.label,
    city: 'Calgary',
    province: 'AB',
    postal: r.raw?.address?.postcode ?? '',
    lat: r.lat,
    lng: r.lng,
  };
}

export default function LocationsStep() {
  const { setPickup, setDropoff } = useBookingStore();
  const draft = useBookingStore((s) => s.draft);

  const [pickupText, setPickupText] = useState(draft.pickup?.line1 ?? '');
  const [pickupGeo, setPickupGeo] = useState<GeocodeResult | null>(
    draft.pickup?.lat && draft.pickup?.lng
      ? ({
          id: 'prefill',
          label: draft.pickup.line1,
          secondary: draft.pickup.city,
          lat: draft.pickup.lat,
          lng: draft.pickup.lng,
          raw: { address: { postcode: draft.pickup.postal } },
        } as GeocodeResult)
      : null
  );

  const [dropoffText, setDropoffText] = useState(draft.dropoff?.line1 ?? '');
  const [dropoffGeo, setDropoffGeo] = useState<GeocodeResult | null>(null);

  const ready = !!pickupGeo && !!dropoffGeo;

  const next = () => {
    if (pickupGeo) setPickup(toAddress(pickupGeo));
    if (dropoffGeo) setDropoff(toAddress(dropoffGeo));
    router.push('/(customer)/book/details');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={1} total={3} label="Locations" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-2xl font-bold text-ink-900 mt-2">Where to and from?</Text>
        <Text className="mt-1 text-sm text-silver-500">
          Movvy serves all of Alberta — Calgary, Edmonton, and every metro in between.
        </Text>

        <View className="mt-5 gap-3">
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              Pickup address
            </Text>
            <AddressAutocomplete
              placeholder="e.g. 1212 17 Ave SW"
              value={pickupText}
              onChangeText={(t) => {
                setPickupText(t);
                if (pickupGeo && t !== pickupGeo.label) setPickupGeo(null);
              }}
              onSelect={(r) => setPickupGeo(r)}
              leftDotColor="#0A0A0A"
            />
          </View>
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              Drop-off address
            </Text>
            <AddressAutocomplete
              placeholder="Where are we taking it?"
              value={dropoffText}
              onChangeText={(t) => {
                setDropoffText(t);
                if (dropoffGeo && t !== dropoffGeo.label) setDropoffGeo(null);
              }}
              onSelect={(r) => setDropoffGeo(r)}
              leftDotColor="#16A34A"
            />
          </View>
        </View>

        <View className="mt-5">
          <LiveMap
            height={220}
            pickup={
              pickupGeo
                ? { lat: pickupGeo.lat, lng: pickupGeo.lng, label: pickupGeo.label }
                : undefined
            }
            dropoff={
              dropoffGeo
                ? { lat: dropoffGeo.lat, lng: dropoffGeo.lng, label: dropoffGeo.label }
                : undefined
            }
            showRoute={ready}
            caption={
              ready
                ? 'Tap continue to confirm — final route calculated by your driver'
                : pickupGeo
                ? 'Add a drop-off address'
                : 'Search above to drop a pin'
            }
          />
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button label="Continue" size="lg" fullWidth disabled={!ready} onPress={next} />
      </View>
    </SafeAreaView>
  );
}
