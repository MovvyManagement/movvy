import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { DateScroller } from '@/components/DateScroller';
import { LiveMap } from '@/components/LiveMap';
import { fmtDateShort, firstNameOf } from '@/lib/format';
import { buildCalendar, firstBookableDay } from '@/lib/scheduling';
import { useBookingStore } from '@/store/bookingStore';
import { cityProvinceFromGeocode, type GeocodeResult } from '@/lib/geocoding';
import { useBookingHistory, useProfile, useSavedAddresses } from '@/lib/data';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuth } from '@/lib/supabase';
import { useEffect } from 'react';
import { isTourSeen } from '../welcome-tour';
import { ReviewPromptHost } from '@/components/ReviewPromptHost';
import { useUserLocation } from '@/lib/useUserLocation';

const quickTypes = [
  { key: 'home_move', label: 'Residential', sub: 'Apartment, condo, house', icon: 'home-outline' as const },
  { key: 'commercial', label: 'Commercial', sub: 'Office, retail, warehouse', icon: 'business-outline' as const },
];

export default function CustomerHome() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: history } = useBookingHistory();
  // Saved Home / Work / custom places — surfaced as quick picks above the
  // pickup field so repeat customers don't have to retype.
  const { data: savedAddresses } = useSavedAddresses();

  // First-time visit → push the 3-slide welcome tour. Stored in AsyncStorage.
  useEffect(() => {
    isTourSeen().then((seen) => {
      if (!seen) router.push('/(customer)/welcome-tour');
    });
  }, []);

  // Friendly fallback to "there" — never surface a demo-seed name to a real
  // user, that's the kind of detail that makes the app feel half-finished.
  const firstName = firstNameOf(
    profile?.full_name ?? (user?.user_metadata as any)?.full_name,
    'there',
  );

  const setPickup = useBookingStore((s) => s.setPickup);
  const setSchedule = useBookingStore((s) => s.setSchedule);

  const days = useMemo(() => buildCalendar(), []);
  const earliest = useMemo(() => firstBookableDay(days), [days]);

  const [pickupText, setPickupText] = useState('');
  const [pickupGeo, setPickupGeo] = useState<GeocodeResult | null>(null);
  const [dropoffText, setDropoffText] = useState('');
  const [dropoffGeo, setDropoffGeo] = useState<GeocodeResult | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(earliest.iso);

  // GPS — fires once on mount, asks for permission, returns the user's
  // current lat/lng. We pass it to LiveMap as the initial center so the
  // map opens around where the customer actually is instead of a generic
  // Calgary downtown view. Returns null if permission denied / GPS off,
  // in which case LiveMap falls back to Calgary centroid.
  const userLoc = useUserLocation();

  const selectedDay = days.find((d) => d.iso === selectedDate) ?? earliest;
  const canBook = !!pickupGeo && !!dropoffGeo;

  const setDropoff = useBookingStore((s) => s.setDropoff);

  const handleBookMove = () => {
    if (!pickupGeo || !dropoffGeo) return;
    // Derive the real city/province per address instead of stamping every
    // booking "Calgary, AB" — the matcher routes on the booking's city, so a
    // hardcoded city silently strands Edmonton/Red Deer/etc. moves.
    const pickupLoc = cityProvinceFromGeocode(pickupGeo);
    const dropoffLoc = cityProvinceFromGeocode(dropoffGeo);
    setPickup({
      label: '',
      line1: pickupGeo.label,
      city: pickupLoc.city,
      province: pickupLoc.province,
      postal: pickupGeo.raw?.address?.postcode ?? '',
      lat: pickupGeo.lat,
      lng: pickupGeo.lng,
    });
    setDropoff({
      label: '',
      line1: dropoffGeo.label,
      city: dropoffLoc.city,
      province: dropoffLoc.province,
      postal: dropoffGeo.raw?.address?.postcode ?? '',
      lat: dropoffGeo.lat,
      lng: dropoffGeo.lng,
    });
    setSchedule(selectedDate, '9:00 AM – 11:00 AM', 'scheduled');
    router.push('/(customer)/book/type');
  };

  return (
    <View className="flex-1 bg-silver-50 dark:bg-night-900">
      {/* Global review prompt — pops as a modal when the driver flags a move
          completed. Mounted on home because that's where the customer almost
          always is when the move ends. Safe to be mounted here even if the
          user is briefly on another tab; React Query keeps the booking state
          fresh and the modal will pop the next time they return to home. */}
      <ReviewPromptHost />
      <SafeAreaView edges={['top']} className="bg-white">
        <View className="px-5 pt-2 pb-4 flex-row items-center justify-between bg-white">
          <View>
            <Text className="text-xs text-silver-500">Hi {firstName}</Text>
            <Text className="text-xl font-bold text-ink-900">Where to today?</Text>
          </View>
          {/* Notification bell — extracted into NotificationBell so the same
              chip is used on Profile and Moves headers too. */}
          <NotificationBell />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* === BOOKING WIDGET ===
            Container intentionally does NOT have `overflow-hidden`: the
            AddressAutocomplete dropdown extends below the input, and we
            need it to overflow the card downward (otherwise typed
            addresses never surface their suggestions). The gradient
            header has its own borderTopLeftRadius/Right so the rounded
            visual stays intact even without parent clipping. */}
        <View className="px-5 pt-4">
          <View className="rounded-3xl bg-white border border-silver-200">
            <LinearGradient
              colors={['#047857', '#16A34A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                padding: 18,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
              }}
            >
              <Text className="text-white/80 text-xs font-bold uppercase tracking-wider">
                Book a move
              </Text>
              <Text className="text-white text-2xl font-bold mt-1">
                Enter an address · pick a date
              </Text>
              <View className="mt-2 flex-row items-center">
                <Ionicons name="navigate" size={12} color="rgba(255,255,255,0.8)" />
                <Text className="ml-1 text-white/80 text-xs font-semibold">
                  Alberta-wide · Calgary, Edmonton, Red Deer & beyond
                </Text>
              </View>
            </LinearGradient>

            <View className="px-5 pt-5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Moving From
              </Text>
              {/* Saved-address quick picks. One tap fills both the visible text
                  AND the geocoded lat/lng (so canBook flips immediately
                  without a network round-trip). */}
              {savedAddresses && savedAddresses.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                >
                  {savedAddresses.slice(0, 6).map((a) => {
                    const isHome = a.label?.toLowerCase() === 'home';
                    const isWork = a.label?.toLowerCase() === 'work';
                    const icon: keyof typeof Ionicons.glyphMap = isHome
                      ? 'home'
                      : isWork
                      ? 'briefcase'
                      : 'location';
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => {
                          setPickupText(a.line1);
                          setPickupGeo({
                            id: `saved-${a.id}`,
                            label: a.line1,
                            secondary: a.city_name,
                            lat: a.lat,
                            lng: a.lng,
                            raw: { address: { postcode: a.postal ?? '' } },
                          } as GeocodeResult);
                        }}
                        className="flex-row items-center rounded-full bg-silver-100 px-3 py-1.5 active:opacity-70"
                      >
                        <Ionicons name={icon} size={14} color="#047857" />
                        <Text className="ml-1.5 text-xs font-bold text-ink-900" numberOfLines={1}>
                          {a.label ?? a.line1}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              <AddressAutocomplete
                placeholder="Enter starting address"
                value={pickupText}
                onChangeText={(t) => {
                  setPickupText(t);
                  if (pickupGeo && t !== `${pickupGeo.label}`) setPickupGeo(null);
                }}
                onSelect={(r) => setPickupGeo(r)}
                leftDotColor="#0A0A0A"
              />
            </View>

            <View className="px-5 pt-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Moving To
              </Text>
              <AddressAutocomplete
                placeholder="Enter destination address"
                value={dropoffText}
                onChangeText={(t) => {
                  setDropoffText(t);
                  if (dropoffGeo && t !== `${dropoffGeo.label}`) setDropoffGeo(null);
                }}
                onSelect={(r) => setDropoffGeo(r)}
                leftDotColor="#16A34A"
              />
            </View>

            <View className="px-5 pt-5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Move date
              </Text>
              <DateScroller value={selectedDate} onChange={setSelectedDate} />
            </View>

            <View className="px-5 pt-5">
              <LiveMap
                height={180}
                pickup={pickupGeo ? { lat: pickupGeo.lat, lng: pickupGeo.lng, label: pickupGeo.label } : undefined}
                dropoff={dropoffGeo ? { lat: dropoffGeo.lat, lng: dropoffGeo.lng, label: dropoffGeo.label } : undefined}
                // Map opens centered on the user's actual GPS location
                // (falls back to Calgary if permission denied).
                initialCenter={userLoc ?? undefined}
                showRoute={!!pickupGeo && !!dropoffGeo}
                caption={
                  pickupGeo && dropoffGeo
                    ? `${pickupGeo.label} → ${dropoffGeo.label}`
                    : pickupGeo
                    ? 'Now pick a drop-off'
                    : 'Pick pickup + drop-off to see route'
                }
              />
            </View>

            {/* No price preview here on purpose — the customer sees the
                total only on the confirm step, after they've picked a
                preset that drives the actual estimate. Showing a number
                under the map before details are picked sets the wrong
                expectation. */}

            <View className="px-5 pt-5 pb-5">
              <Button
                label={
                  canBook
                    ? 'Continue Booking Move'
                    : !pickupGeo
                    ? 'Enter where you’re moving from'
                    : 'Enter where you’re moving to'
                }
                size="lg"
                fullWidth
                disabled={!canBook}
                onPress={handleBookMove}
              />
            </View>
          </View>
        </View>

        {/* Note: the "Active move" card used to live here. Removed because
            the Moves tab already shows a green dot badge when a move is
            in progress AND opens straight into the live tracker, so this
            card was just visual noise duplicating that signal. */}

        {/* Services provided — visible but not interactive */}
        <View className="px-5 pt-6">
          <View className="mb-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
              Services provided
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            {quickTypes.map((t) => (
              <View key={t.key} className="w-[48%] rounded-3xl border border-silver-200 bg-white p-4">
                <View className="h-10 w-10 rounded-2xl bg-silver-100 items-center justify-center">
                  <Ionicons name={t.icon} size={20} color="#71717A" />
                </View>
                <Text className="mt-3 text-base font-bold text-ink-900">{t.label}</Text>
                <Text className="text-xs text-silver-500 mt-0.5">{t.sub}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Move history — only renders if the customer has at least one completed move. */}
        {history.length > 0 ? (
          <View className="px-5 pt-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
                Move history
              </Text>
              <Pressable onPress={() => router.push('/(customer)/bookings')}>
                <Text className="text-sm font-semibold text-brand-700">See all</Text>
              </Pressable>
            </View>
            {history.slice(0, 2).map((b) => (
              <View key={b.id} className="mb-3">
                <Card onPress={() => router.push('/(customer)/bookings')}>
                  <View className="flex-row items-center">
                    <View className="h-11 w-11 rounded-2xl bg-silver-100 items-center justify-center">
                      <Ionicons name="cube" size={18} color="#0A0A0A" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900" numberOfLines={1}>
                        {b.pickup_line1} → {b.dropoff_line1 ?? 'in-home'}
                      </Text>
                      <Text className="text-xs text-silver-500">
                        {fmtDateShort(b.scheduled_for_date)} · ${(b.price_total_cents / 100).toFixed(0)} CAD
                      </Text>
                    </View>
                    <Badge label="Completed" tone="neutral" />
                  </View>
                </Card>
              </View>
            ))}
          </View>
        ) : null}

        <View className="px-5 pt-6">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Join Movvy
          </Text>
          <Pressable
            onPress={() => router.push('/partner')}
            className="rounded-3xl overflow-hidden active:opacity-90"
          >
            <LinearGradient
              colors={['#0A0A0A', '#171717']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20 }}
            >
              <View className="flex-row items-center">
                <View className="h-14 w-14 rounded-2xl bg-brand-600 items-center justify-center">
                  <Ionicons name="rocket" size={22} color="#fff" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-white text-base font-bold">Become a Movvy Partner</Text>
                  <Text className="text-white/70 text-xs mt-0.5 leading-4">
                    Independent movers and moving companies — sign up to start earning.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </View>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

