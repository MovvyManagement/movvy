// =============================================================================
// /(customer)/saved-addresses — Home, Work, and custom favourites
//
// Every repeat customer wants Home/Work shortcuts. This screen is where
// they manage them; the booking widget on Home reads from useSavedAddresses
// to show recent picks above the autocomplete dropdown.
//
// Tap a saved address from anywhere to drop it straight into the booking
// flow (the home-screen pickup / dropoff inputs accept a savedAddress prop
// that pre-fills both the text label + the lat/lng so we skip geocoding).
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useToast } from '@/components/Toast';
import { useSavedAddresses, useSaveAddress, useDeleteSavedAddress } from '@/lib/data';
import { cityForCoord, closestMajorCity } from '@/lib/distance';
import { supabase } from '@/lib/supabase';
import type { GeocodeResult } from '@/lib/geocoding';

export default function SavedAddresses() {
  const { data: addresses, isLoading } = useSavedAddresses();
  const save = useSaveAddress();
  const remove = useDeleteSavedAddress();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [addrText, setAddrText] = useState('');
  const [geo, setGeo] = useState<GeocodeResult | null>(null);

  const hasHome = (addresses ?? []).some((a) => a.label?.toLowerCase() === 'home');
  const hasWork = (addresses ?? []).some((a) => a.label?.toLowerCase() === 'work');

  const addAddress = async (preset?: 'Home' | 'Work') => {
    setLabel(preset ?? '');
    setAddrText('');
    setGeo(null);
    setAdding(true);
  };

  const saveNew = async () => {
    if (!geo) {
      toast.error('Pick an address from the dropdown first.');
      return;
    }
    try {
      // Resolve the city from the ADDRESS the customer actually picked. This
      // used to query the 'calgary' slug unconditionally, so every saved
      // address in all ten service cities was stored as Calgary — which then
      // fed the wrong HQ into pricing when the address was reused for a
      // booking. Exact bounding-box hit first, nearest major city otherwise.
      const coord = { lat: geo.lat, lng: geo.lng };
      const slug = cityForCoord(coord) ?? closestMajorCity(coord).slug;
      const { data: city } = await supabase
        .from('cities').select('id, name, region, country_code').eq('slug', slug).single();
      const fallbackName = closestMajorCity(coord).name;
      await save.mutateAsync({
        label: label.trim() || undefined,
        line1: geo.label,
        city_id: city?.id ?? '',
        city_name: city?.name ?? fallbackName,
        region: city?.region ?? 'AB',
        country_code: city?.country_code ?? 'CA',
        lat: geo.lat,
        lng: geo.lng,
        is_default: (addresses ?? []).length === 0, // first added becomes default
      });
      toast.success('Address saved');
      setAdding(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save address. Try again.");
    }
  };

  const onDelete = (id: string, displayName: string) => {
    Alert.alert('Remove address?', `${displayName} will be removed from your saved addresses.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await remove.mutateAsync(id);
            toast.success('Address removed');
          } catch (e: any) {
            toast.error(e?.message ?? "Couldn't remove address.");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Saved Addresses" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Quick-add Home / Work shortcuts — most-requested by repeat customers */}
        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={() => addAddress('Home')}
            disabled={hasHome}
            className={`flex-1 rounded-3xl border-2 border-dashed items-center justify-center py-6 active:opacity-70 ${
              hasHome ? 'border-silver-200 opacity-40' : 'border-brand-300'
            }`}
          >
            <Ionicons name="home-outline" size={24} color={hasHome ? '#A1A1AA' : '#047857'} />
            <Text className={`mt-1 text-sm font-bold ${hasHome ? 'text-silver-500' : 'text-brand-700'}`}>
              {hasHome ? 'Home added' : '+ Home'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => addAddress('Work')}
            disabled={hasWork}
            className={`flex-1 rounded-3xl border-2 border-dashed items-center justify-center py-6 active:opacity-70 ${
              hasWork ? 'border-silver-200 opacity-40' : 'border-brand-300'
            }`}
          >
            <Ionicons name="briefcase-outline" size={24} color={hasWork ? '#A1A1AA' : '#047857'} />
            <Text className={`mt-1 text-sm font-bold ${hasWork ? 'text-silver-500' : 'text-brand-700'}`}>
              {hasWork ? 'Work added' : '+ Work'}
            </Text>
          </Pressable>
        </View>

        {/* Inline "add" form — shown when the user taps a shortcut OR the
            custom "+ Add an address" button below. */}
        {adding ? (
          <Card className="mb-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              New saved address
            </Text>
            <View className="gap-3">
              <Input
                label="Label (optional)"
                placeholder="e.g. Mom's place"
                value={label}
                onChangeText={setLabel}
              />
              <View>
                <Text className="text-sm font-semibold text-ink-900 mb-2">Address</Text>
                <AddressAutocomplete
                  placeholder="Start typing an address"
                  value={addrText}
                  onChangeText={(t) => {
                    setAddrText(t);
                    if (geo && t !== geo.label) setGeo(null);
                  }}
                  onSelect={(r) => setGeo(r)}
                />
              </View>
              <View className="flex-row gap-2 mt-2">
                <Pressable
                  onPress={() => setAdding(false)}
                  className="flex-1 h-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
                >
                  <Text className="text-sm font-bold text-ink-900">Cancel</Text>
                </Pressable>
                <View className="flex-[2]">
                  <Button
                    label="Save address"
                    size="md"
                    fullWidth
                    loading={save.isPending}
                    disabled={!geo}
                    onPress={saveNew}
                  />
                </View>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Saved list */}
        {isLoading && !addresses ? (
          <CardSkeleton count={2} />
        ) : !addresses || addresses.length === 0 ? (
          <EmptyState
            icon="bookmark-outline"
            title="No saved addresses yet"
            body="Save your home, work, or favourite places to skip retyping every time you book a move."
          />
        ) : (
          addresses.map((a) => {
            const isFav = a.label && ['home', 'work'].includes(a.label.toLowerCase());
            const icon: keyof typeof Ionicons.glyphMap = isFav
              ? a.label!.toLowerCase() === 'home'
                ? 'home'
                : 'briefcase'
              : 'location';
            return (
              <View key={a.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
                      <Ionicons name={icon} size={18} color="#047857" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-bold text-ink-900">
                        {a.label ?? a.line1}
                      </Text>
                      {a.label ? (
                        <Text className="text-xs text-silver-500" numberOfLines={1}>
                          {a.line1}
                        </Text>
                      ) : null}
                      <Text className="text-[11px] text-silver-400 mt-0.5">{a.city_name}</Text>
                    </View>
                    <Pressable
                      onPress={() => onDelete(a.id, a.label ?? a.line1)}
                      hitSlop={8}
                      className="h-9 w-9 rounded-full items-center justify-center"
                    >
                      <Ionicons name="trash-outline" size={18} color="#71717A" />
                    </Pressable>
                  </View>
                </Card>
              </View>
            );
          })
        )}

        {!adding ? (
          <Pressable
            onPress={() => addAddress()}
            className="mt-2 flex-row items-center justify-center py-4 rounded-2xl border border-dashed border-silver-300 active:opacity-70"
          >
            <Ionicons name="add" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">Add another address</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
