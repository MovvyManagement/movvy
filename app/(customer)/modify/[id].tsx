// =============================================================================
// /(customer)/modify/[id] — change date, addresses, or notes on an
// upcoming booking. Available until 24h before the move.
//
// Cutoff + ownership are enforced server-side by the bookings-modify edge
// function. The UI just hides the screen behind a "Modify booking" button
// on the Moves tab that only shows when the booking is still modifiable.
//
// The 20% deposit is NON-REFUNDABLE — modifying changes the plan but the
// customer's deposit commitment stays. We make that explicit at the top.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { DateScroller } from '@/components/DateScroller';
import { useBooking, useModifyBooking } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { buildCalendar } from '@/lib/scheduling';
import { fmtDateShort } from '@/lib/format';
import { cityProvinceFromGeocode, type GeocodeResult } from '@/lib/geocoding';

const WINDOWS = ['9:00 AM – 11:00 AM', '11:00 AM – 1:00 PM', '1:00 PM – 3:00 PM', '3:00 PM – 5:00 PM'];

export default function ModifyBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, isLoading } = useBooking(id);
  const modify = useModifyBooking();
  const toast = useToast();

  const days = React.useMemo(() => buildCalendar(), []);
  const [date, setDate] = useState<string>('');
  const [windowLabel, setWindowLabel] = useState<string>('');
  const [pickupText, setPickupText] = useState('');
  const [pickupGeo, setPickupGeo] = useState<GeocodeResult | null>(null);
  const [dropoffText, setDropoffText] = useState('');
  const [dropoffGeo, setDropoffGeo] = useState<GeocodeResult | null>(null);
  const [notes, setNotes] = useState('');

  // Seed local state once the booking loads
  useEffect(() => {
    if (!booking) return;
    setDate(booking.scheduled_for_date);
    setWindowLabel(booking.scheduled_for_window ?? WINDOWS[0]);
    setPickupText(booking.pickup_line1 ?? '');
    setDropoffText(booking.dropoff_line1 ?? '');
    setNotes((booking as any).customer_notes ?? '');
  }, [booking]);

  // Eligibility — 24h cutoff
  const startMs = booking
    ? booking.scheduled_for_window_starts_at
      ? new Date(booking.scheduled_for_window_starts_at).getTime()
      : new Date(`${booking.scheduled_for_date}T00:00:00`).getTime()
    : 0;
  const hoursUntil = (startMs - Date.now()) / (1000 * 60 * 60);
  const tooLate = booking ? hoursUntil < 24 : false;
  const inFlight = booking
    ? !['pending', 'searching', 'assigned', 'confirmed'].includes(booking.status)
    : false;
  const blocked = tooLate || inFlight;

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#16A34A" />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Modify booking" />
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <Ionicons name="alert-circle-outline" size={32} color="#71717A" />
          <Text className="mt-2 text-base font-bold text-ink-900">Booking not found</Text>
          <Text className="mt-1 text-sm text-silver-500 text-center">
            This booking may have been cancelled or doesn't belong to you.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = async () => {
    if (blocked) return;
    try {
      // Build the patch — only send fields that actually changed
      const args: Parameters<typeof modify.mutateAsync>[0] = { booking_id: booking.id };
      if (date !== booking.scheduled_for_date) args.scheduled_for_date = date;
      if (windowLabel !== booking.scheduled_for_window) args.scheduled_for_window = windowLabel;
      if (notes !== ((booking as any).customer_notes ?? '')) args.customer_notes = notes;
      // City + province come from the geocode result, never a constant. Movvy
      // runs in ten Alberta cities and every crew has its own HQ, so stamping
      // 'Calgary' on a Lethbridge address made the server re-quote the move
      // from the wrong HQ — wrong travel time, and on anything near the 100 km
      // line, the wrong side of local-vs-long-haul entirely.
      if (pickupGeo) {
        const { city, province } = cityProvinceFromGeocode(pickupGeo);
        args.pickup = {
          line1: pickupGeo.label,
          city,
          region: province,
          country_code: 'CA',
          lat: pickupGeo.lat,
          lng: pickupGeo.lng,
        };
      }
      if (dropoffGeo) {
        const { city, province } = cityProvinceFromGeocode(dropoffGeo);
        args.dropoff = {
          line1: dropoffGeo.label,
          city,
          region: province,
          country_code: 'CA',
          lat: dropoffGeo.lat,
          lng: dropoffGeo.lng,
        };
      }

      const sentKeys = Object.keys(args).filter((k) => k !== 'booking_id');
      if (sentKeys.length === 0) {
        toast.info('No changes to save.');
        return;
      }

      await modify.mutateAsync(args);
      toast.success('Booking updated');
      router.back();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save changes.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Modify booking" subtitle={`#${booking.short_code}`} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cutoff warning */}
          {blocked ? (
            <View className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex-row items-start mb-4">
              <Ionicons name="alert-circle" size={20} color="#B45309" />
              <View className="ml-2 flex-1">
                <Text className="text-sm font-bold text-amber-900">Modifications closed</Text>
                {/* State the actual choice and what it costs. "Contact support"
                    on its own sends someone into a chat to be told the rule —
                    they can read it here and decide. Inside 24 hours is also
                    inside the 48-hour refund window, so cancelling now forfeits
                    the deposit; that's the whole decision, so say it. */}
                <Text className="text-xs text-amber-800 mt-1 leading-4">
                  {inFlight
                    ? 'This booking is already in progress or completed and can no longer be edited.'
                    : 'Your move is less than 24 hours away, so the details are locked in. Your only option now is to cancel, and this close to the move the 20% deposit is not refunded — it goes to the crew who held the slot. Message us if something has gone wrong and we\'ll see what we can do.'}
                </Text>
              </View>
            </View>
          ) : (
            <View className="rounded-2xl bg-silver-50 p-4 flex-row items-start mb-4">
              <Ionicons name="information-circle-outline" size={18} color="#71717A" />
              <Text className="ml-2 flex-1 text-xs text-silver-600 leading-4">
                You can edit your move up until 24 hours before the scheduled
                start. Your 20% deposit stays attached to this move — it's
                refunded only if you cancel more than 48 hours before the
                scheduled start.
              </Text>
            </View>
          )}

          {/* Date */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Move date
          </Text>
          <DateScroller value={date} onChange={setDate} />

          {/* Window */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Time window
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {WINDOWS.map((w) => {
              const sel = windowLabel === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => setWindowLabel(w)}
                  disabled={blocked}
                  className={`px-4 py-2.5 rounded-full border ${
                    sel ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-200'
                  }`}
                >
                  <Text className={`text-sm font-semibold ${sel ? 'text-white' : 'text-ink-900'}`}>
                    {w}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Pickup */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Moving From
          </Text>
          <Card className="p-3">
            <Text className="text-xs text-silver-500 mb-2">Current: {booking.pickup_line1}</Text>
            <AddressAutocomplete
              placeholder="Type to change pickup address"
              value={pickupText}
              onChangeText={(t) => {
                setPickupText(t);
                if (pickupGeo && t !== pickupGeo.label) setPickupGeo(null);
              }}
              onSelect={(r) => setPickupGeo(r)}
            />
          </Card>

          {/* Drop-off */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Moving To
          </Text>
          <Card className="p-3">
            <Text className="text-xs text-silver-500 mb-2">
              Current: {booking.dropoff_line1 ?? 'In-home (no drop-off)'}
            </Text>
            <AddressAutocomplete
              placeholder="Type to change drop-off address"
              value={dropoffText}
              onChangeText={(t) => {
                setDropoffText(t);
                if (dropoffGeo && t !== dropoffGeo.label) setDropoffGeo(null);
              }}
              onSelect={(r) => setDropoffGeo(r)}
            />
          </Card>

          {/* Notes */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Notes for your crew
          </Text>
          <View className="rounded-2xl border border-silver-200 bg-white p-3">
            <TextInput
              multiline
              value={notes}
              onChangeText={setNotes}
              placeholder="Buzz #404. Loading zone out front. Cat in unit."
              placeholderTextColor="#A1A1AA"
              editable={!blocked}
              className="text-base text-ink-900"
              style={{ minHeight: 80, textAlignVertical: 'top' }}
            />
          </View>
        </ScrollView>

        <View
          className="px-5 pt-3 border-t border-silver-100 bg-white"
          style={{ paddingBottom: 28 }}
        >
          <Button
            label={blocked ? 'Modifications closed' : 'Save changes'}
            size="lg"
            fullWidth
            disabled={blocked}
            loading={modify.isPending}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
