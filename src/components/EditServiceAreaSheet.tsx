// =============================================================================
// EditServiceAreaSheet
//
// Lets the operator (team driver) pick the primary city + service radius the
// team's job feed scopes to. Same two fields the partner onboarding asked for —
// post-onboarding, this is the single editor that lets them grow into another
// market or tighten their range without contacting support.
//
// Writes partner_teams.primary_city_id + service_radius_km. RLS allows any
// team member to update, so the driver can do this themselves.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from './Chip';
import { useCities, useTeam, useUpdateTeam } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  teamId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

// Radius steps cap at 200 km — same upper bound the partner_teams CHECK
// constraint enforces. 5/10/15/25/50/100/200 covers urban → long-haul.
const RADIUS_STEPS = [5, 10, 15, 25, 50, 100, 200];

export function EditServiceAreaSheet({ visible, teamId, onClose }: Props) {
  const { data: team } = useTeam(teamId);
  const { data: cities } = useCities();
  const update = useUpdateTeam(teamId);
  const toast = useToast();

  const [cityId, setCityId] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(15);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !team) return;
    setCityId(team.primary_city_id);
    setRadius(team.service_radius_km);
  }, [visible, team]);

  const changed =
    !!team &&
    (cityId !== team.primary_city_id || radius !== team.service_radius_km);
  const canSave = !!team && !!cityId && !saving && changed;

  const save = async () => {
    if (!canSave || !cityId) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        primary_city_id: cityId,
        service_radius_km: radius,
      });
      haptic.success();
      toast.success('Service area updated');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update your service area.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCity = cities?.find((c) => c.id === cityId);

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Service area</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Pick the city your crew works out of and how far you'll drive. Jobs
        outside this radius won't be offered to you.
      </Text>

      <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
        Primary city
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {(cities ?? []).map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={cityId === c.id}
            onPress={() => setCityId(c.id)}
          />
        ))}
      </ScrollView>

      <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
        Radius around {selectedCity?.name ?? 'your city'}
      </Text>

      <View className="flex-row flex-wrap gap-2">
        {RADIUS_STEPS.map((km) => {
          const active = radius === km;
          return (
            <Pressable
              key={km}
              onPress={() => setRadius(km)}
              className={`px-4 py-3 rounded-2xl border ${
                active ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
              }`}
              accessibilityRole="button"
              accessibilityLabel={`${km} kilometre radius`}
            >
              <Text
                className={`text-sm font-bold ${
                  active ? 'text-brand-700' : 'text-ink-900'
                }`}
              >
                {km} km
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-5 rounded-2xl bg-brand-50 border border-brand-100 p-4 flex-row">
        <Ionicons name="information-circle-outline" size={18} color="#047857" />
        <Text className="ml-2 flex-1 text-xs text-ink-700 leading-5">
          You currently see jobs within{' '}
          <Text className="font-bold">{radius} km</Text> of{' '}
          <Text className="font-bold">{selectedCity?.name ?? '—'}</Text>. Long-haul
          jobs above this distance are offered separately with a surcharge.
        </Text>
      </View>

      <Pressable
        onPress={save}
        disabled={!canSave}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          canSave ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Save service area</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onClose} className="mt-2 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
      </Pressable>
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            {body}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            {body}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
