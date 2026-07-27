import React, { useMemo, useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Card } from '@/components/Card';
import { MovvyMark } from '@/components/MovvyMark';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AddressSearchSheet } from '@/components/AddressSearchSheet';
import { DateScroller } from '@/components/DateScroller';
import { LiveMap } from '@/components/LiveMap';
import { fmtDateShort, firstNameOf } from '@/lib/format';
import { buildCalendar, firstBookableDay } from '@/lib/scheduling';
import { useBookingStore } from '@/store/bookingStore';
import { cityProvinceFromGeocode, type GeocodeResult } from '@/lib/geocoding';
import { roadKm } from '@/lib/distance';
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

  // Option B — guided flow: one question is expanded at a time. Filled steps
  // collapse to a tappable summary so the screen never feels like a wall of
  // fields, and the map above grows into the hero. `active` is the currently
  // open question; selecting an address auto-advances to the next.
  const [active, setActive] = useState<'from' | 'to' | 'when'>('from');

  // Distance + time for the chip that floats on the map once both ends are in.
  // roadKm() is the crude straight-line→road factor used elsewhere; the time
  // estimate assumes ~35 km/h average city driving. Both are labelled "~" —
  // the real ETA comes from the routing engine on the live-tracking screen.
  const trip = useMemo(() => {
    if (!pickupGeo || !dropoffGeo) return null;
    const km = roadKm(pickupGeo, dropoffGeo);
    const mins = Math.max(5, Math.round((km / 35) * 60 / 5) * 5);
    return { km: km < 10 ? km.toFixed(1) : String(Math.round(km)), mins };
  }, [pickupGeo, dropoffGeo]);

  // GPS — fires once on mount, asks for permission, returns the user's
  // current lat/lng. We pass it to LiveMap as the initial center so the
  // map opens around where the customer actually is instead of a generic
  // Calgary downtown view. Returns null if permission denied / GPS off,
  // in which case LiveMap falls back to Calgary centroid.
  const userLoc = useUserLocation();

  const selectedDay = days.find((d) => d.iso === selectedDate) ?? earliest;
  const canBook = !!pickupGeo && !!dropoffGeo;

  const setDropoff = useBookingStore((s) => s.setDropoff);

  // Option B is a full-bleed map hero with the guided card floating over its
  // lower edge. Size the map to a chunk of the viewport so the card peeks above
  // the fold, then clamp so it's sane on very short / very tall devices.
  const { height: winH } = useWindowDimensions();
  const mapHeight = Math.min(460, Math.max(320, Math.round(winH * 0.46)));

  // Keyboard fix: when an address field focuses, scroll the floating card up to
  // just under the header so its suggestions dropdown clears the keyboard
  // instead of hiding behind it. cardY is captured via onLayout.
  const scrollRef = useRef<ScrollView>(null);
  const cardY = useRef(0);

  // Which address field's full-screen search sheet is open (null = closed).
  // Tapping a field opens the sheet so its suggestions sit above the keyboard
  // instead of hiding behind it.
  const [searchFor, setSearchFor] = useState<'from' | 'to' | null>(null);

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

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        {...(Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {})}
      >
        {/* === BOOKING WIDGET — Option B (guided) ===
            The map is the HERO — a full-bleed panel across the top that confirms
            the move visually with pins + a route line + a distance/time chip.
            The guided card FLOATS over the map's lower edge and asks one thing
            at a time ("Where from?" → "Where to?" → "When?"); answered steps
            collapse to a tappable summary. Focusing an address field scrolls the
            card up so its suggestions clear the keyboard. */}

        {/* MAP HERO — full-bleed */}
        <View style={{ height: mapHeight }}>
          <LiveMap
            height={mapHeight}
            borderRadius={0}
            pickup={pickupGeo ? { lat: pickupGeo.lat, lng: pickupGeo.lng, label: pickupGeo.label } : undefined}
            dropoff={dropoffGeo ? { lat: dropoffGeo.lat, lng: dropoffGeo.lng, label: dropoffGeo.label } : undefined}
            initialCenter={userLoc ?? undefined}
            showRoute={!!pickupGeo && !!dropoffGeo}
          />
          {/* Floating chip: distance + time once both ends are set,
              otherwise a gentle nudge toward the next step. */}
          {trip ? (
            <View
              className="absolute top-3 self-center flex-row items-center rounded-full bg-white px-3 py-1.5 border border-silver-200"
              style={{ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}
            >
              <Ionicons name="navigate-circle" size={14} color="#047857" />
              <Text className="ml-1.5 text-xs font-bold text-brand-700">~{trip.km} km</Text>
              <View className="mx-2 h-1 w-1 rounded-full bg-silver-300" />
              <Text className="text-xs font-semibold text-ink-900">~{trip.mins} min</Text>
            </View>
          ) : (
            <View className="absolute top-3 self-center rounded-full bg-black/55 px-3 py-1.5">
              <Text className="text-xs font-semibold text-white">
                {!pickupGeo ? 'Start with your pick-up' : 'Now add your drop-off'}
              </Text>
            </View>
          )}
        </View>

        {/* FLOATING GUIDED CARD — overlaps the map's lower edge */}
        <View
          onLayout={(e) => {
            cardY.current = e.nativeEvent.layout.y;
          }}
          className="mx-4 rounded-3xl bg-white border border-silver-200"
          style={{ marginTop: -30, shadowColor: '#063C28', shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 }}
        >
          {/* GUIDED SECTION */}
          <View className="px-5 pt-4 pb-5">
              {/* progress: pick-up · drop-off · date */}
              <View className="flex-row gap-1.5 mb-4">
                <View className={`h-1 flex-1 rounded-full ${pickupGeo ? 'bg-brand-600' : active === 'from' ? 'bg-brand-200' : 'bg-silver-200'}`} />
                <View className={`h-1 flex-1 rounded-full ${dropoffGeo ? 'bg-brand-600' : active === 'to' ? 'bg-brand-200' : 'bg-silver-200'}`} />
                <View className={`h-1 flex-1 rounded-full ${active === 'when' ? 'bg-brand-600' : 'bg-silver-200'}`} />
              </View>

              {/* ── FROM ── */}
              {active === 'from' ? (
                <View>
                  <Text className="text-2xl font-bold text-ink-900" style={{ letterSpacing: -0.4 }}>
                    Where are you moving from?
                  </Text>
                  <Text className="mt-1 mb-3 text-sm text-silver-500">
                    We’ll match you with crews near here.
                  </Text>
                  {savedAddresses && savedAddresses.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                    >
                      {savedAddresses.slice(0, 6).map((a) => {
                        const isHome = a.label?.toLowerCase() === 'home';
                        const isWork = a.label?.toLowerCase() === 'work';
                        const icon: keyof typeof Ionicons.glyphMap = isHome ? 'home' : isWork ? 'briefcase' : 'location';
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
                              setActive('to');
                            }}
                            className="flex-row items-center rounded-full bg-silver-100 px-3 py-2 active:opacity-70"
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
                  <Pressable
                    onPress={() => setSearchFor('from')}
                    className="flex-row items-center rounded-2xl border bg-white px-4 border-silver-200"
                    style={{ minHeight: 52 }}
                  >
                    <View className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: '#0A0A0A' }} />
                    <Text
                      className={`flex-1 text-base ${pickupText ? 'text-ink-900' : 'text-silver-400'}`}
                      numberOfLines={1}
                    >
                      {pickupText || 'Enter starting address'}
                    </Text>
                    {pickupText ? (
                      <Pressable onPress={() => { setPickupText(''); setPickupGeo(null); }} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color="#A1A1AA" />
                      </Pressable>
                    ) : (
                      <Ionicons name="search" size={18} color="#A1A1AA" />
                    )}
                  </Pressable>
                </View>
              ) : pickupGeo ? (
                <TripRow tone="origin" label="Pick-up" value={pickupGeo.label} onEdit={() => setActive('from')} />
              ) : null}

              {/* ── TO ── */}
              {active === 'to' ? (
                <View className="mt-2">
                  <Text className="text-2xl font-bold text-ink-900" style={{ letterSpacing: -0.4 }}>
                    And where to?
                  </Text>
                  <Text className="mt-1 mb-3 text-sm text-silver-500">
                    Your route and distance appear as you go.
                  </Text>
                  <Pressable
                    onPress={() => setSearchFor('to')}
                    className="flex-row items-center rounded-2xl border bg-white px-4 border-silver-200"
                    style={{ minHeight: 52 }}
                  >
                    <View className="mr-3 h-3 w-3 rounded-sm" style={{ backgroundColor: '#16A34A' }} />
                    <Text
                      className={`flex-1 text-base ${dropoffText ? 'text-ink-900' : 'text-silver-400'}`}
                      numberOfLines={1}
                    >
                      {dropoffText || 'Enter destination address'}
                    </Text>
                    {dropoffText ? (
                      <Pressable onPress={() => { setDropoffText(''); setDropoffGeo(null); }} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color="#A1A1AA" />
                      </Pressable>
                    ) : (
                      <Ionicons name="search" size={18} color="#A1A1AA" />
                    )}
                  </Pressable>
                </View>
              ) : dropoffGeo ? (
                <TripRow tone="dest" label="Drop-off" value={dropoffGeo.label} onEdit={() => setActive('to')} />
              ) : pickupGeo ? (
                <Pressable
                  onPress={() => setActive('to')}
                  className="mt-2 flex-row items-center rounded-2xl border border-dashed border-silver-300 px-4 py-4 active:opacity-70"
                >
                  <View className="h-3 w-3 rounded-sm bg-brand-500" />
                  <Text className="ml-3 text-base font-semibold text-silver-500">Add drop-off address</Text>
                </Pressable>
              ) : null}

              {/* ── WHEN ── */}
              {active === 'when' ? (
                <View className="mt-4">
                  <Text className="text-2xl font-bold text-ink-900" style={{ letterSpacing: -0.4 }}>
                    When’s the big day?
                  </Text>
                  <Text className="mt-1 mb-3 text-sm text-silver-500">
                    Pick a date — you’ll choose an arrival window next.
                  </Text>
                  <DateScroller value={selectedDate} onChange={setSelectedDate} />
                </View>
              ) : pickupGeo && dropoffGeo ? (
                <TripRow tone="date" label="When" value={fmtDateShort(selectedDate)} onEdit={() => setActive('when')} />
              ) : null}

              {/* CTA */}
              <View className="pt-5">
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
              <Pressable onPress={() => router.push('/(customer)/(tabs)/bookings')}>
                <Text className="text-sm font-semibold text-brand-700">See all</Text>
              </Pressable>
            </View>
            {history.slice(0, 2).map((b) => (
              <View key={b.id} className="mb-3">
                <Card onPress={() => router.push('/(customer)/(tabs)/bookings')}>
                  <View className="flex-row items-center">
                    <MovvyMark size={44} />
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

      {/* Full-screen address search — opens above the keyboard so suggestions
          are never hidden behind it. */}
      <AddressSearchSheet
        visible={searchFor !== null}
        placeholder={searchFor === 'to' ? 'Enter destination address' : 'Enter starting address'}
        accent={searchFor === 'to' ? '#16A34A' : '#0A0A0A'}
        initialQuery={searchFor === 'to' ? dropoffText : pickupText}
        onClose={() => setSearchFor(null)}
        onSelect={(r, text) => {
          if (searchFor === 'to') {
            setDropoffText(text);
            setDropoffGeo(r);
            setActive('when');
          } else {
            setPickupText(text);
            setPickupGeo(r);
            setActive('to');
          }
        }}
      />
    </View>
  );
}

// A completed step, collapsed to a single tappable line. Keeps answered
// questions visible (and editable) without re-expanding their input — the
// core of the guided flow's "one question at a time" feel.
function TripRow({
  tone,
  label,
  value,
  onEdit,
}: {
  tone: 'origin' | 'dest' | 'date';
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <Pressable
      onPress={onEdit}
      className="mt-2 flex-row items-center rounded-2xl bg-silver-50 px-4 py-3.5 active:opacity-70"
    >
      {tone === 'origin' ? (
        <View className="h-3 w-3 rounded-full border-2 border-ink-900" />
      ) : tone === 'dest' ? (
        <View className="h-3 w-3 rounded-sm bg-brand-600" />
      ) : (
        <Ionicons name="calendar-clear" size={15} color="#047857" />
      )}
      <View className="ml-3 flex-1">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">{label}</Text>
        <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text className="text-xs font-semibold text-brand-700">Edit</Text>
    </Pressable>
  );
}

