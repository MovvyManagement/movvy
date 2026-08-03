// =============================================================================
// AddTruckSheet
//
// Adds a row to the `vehicles` table tied to the current company. Used
// from the Trucks screen.
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
import { Input } from './Input';
import { useAddCompanyVehicle } from '@/lib/data';
import type { VehicleRow } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

// Box length in FEET is what decides which moves the org can accept (see
// src/lib/truckFit.ts + migration 0082). The legacy `type` enum is kept in step
// for back-compat but is too coarse to express the 20/22 ft bands.
const TYPES: {
  key: VehicleRow['type'];
  ft: number;
  label: string;
  sub: string;
}[] = [
  { key: 'cargo_van', ft: 10, label: 'Cargo van', sub: 'Single items / labour' },
  { key: 'cube_van_16', ft: 16, label: '16 ft', sub: 'Up to 1-bed apartment' },
  { key: 'cube_van_16', ft: 20, label: '20 ft', sub: '2-bed apt · 2-bed house' },
  { key: 'box_truck_24', ft: 22, label: '22 ft', sub: '3-bed apartment' },
  { key: 'box_truck_24', ft: 24, label: '24 ft', sub: '3-bed house' },
  { key: 'box_truck_26', ft: 26, label: '26 ft', sub: '4-bed house' },
];

export function AddTruckSheet({ visible, companyId, onClose }: Props) {
  const add = useAddCompanyVehicle(companyId);
  const toast = useToast();

  const [type, setType] = useState<VehicleRow['type']>('cube_van_16');
  const [lengthFt, setLengthFt] = useState<number>(16);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [province, setProvince] = useState('AB');
  const [capacity, setCapacity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setType('cube_van_16');
    setLengthFt(16);
    setMake('');
    setModel('');
    setYear('');
    setPlate('');
    setProvince('AB');
    setCapacity('');
  }, [visible]);

  const valid =
    !saving &&
    make.trim().length >= 2 &&
    model.trim().length >= 1 &&
    plate.trim().length >= 2 &&
    /^[A-Z]{2}$/.test(province.trim().toUpperCase()) &&
    (year === '' || /^[0-9]{4}$/.test(year));

  const save = async () => {
    if (!valid || !companyId) return;
    setSaving(true);
    try {
      await add.mutateAsync({
        type,
        make: make.trim(),
        model: model.trim(),
        year: year ? Number(year) : null,
        plate: plate.trim(),
        province: province.trim().toUpperCase(),
        capacity_cu_ft: capacity ? Number(capacity) : null,
        length_ft: lengthFt,
      });
      haptic.success();
      toast.success('Truck added');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add truck.");
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Add a truck</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Trucks are matched to bookings based on size. The dispatcher can
        assign any approved truck when picking a driver.
      </Text>

      <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
        Size
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {TYPES.map((t) => {
          const active = t.ft === lengthFt;
          return (
            <Pressable
              key={t.ft}
              onPress={() => {
                setLengthFt(t.ft);
                setType(t.key);
              }}
              className={`px-3 py-2 rounded-2xl border ${
                active ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
              }`}
            >
              <Text
                className={`text-sm font-bold ${active ? 'text-brand-700' : 'text-ink-900'}`}
              >
                {t.label}
              </Text>
              <Text className="text-[11px] text-silver-500 mt-0.5">{t.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-5 gap-3">
        <View className="flex-row gap-3">
          <View style={{ flex: 1 }}>
            <Input
              label="Make"
              placeholder="Ford"
              autoCapitalize="words"
              value={make}
              onChangeText={setMake}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Model"
              placeholder="E-450"
              autoCapitalize="words"
              value={model}
              onChangeText={setModel}
            />
          </View>
        </View>
        <View className="flex-row gap-3">
          <View style={{ flex: 1 }}>
            <Input
              label="Year"
              placeholder="2020"
              keyboardType="number-pad"
              maxLength={4}
              value={year}
              onChangeText={(t) => setYear(t.replace(/[^0-9]/g, '').slice(0, 4))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Capacity (cu ft)"
              placeholder="850"
              keyboardType="number-pad"
              value={capacity}
              onChangeText={(t) => setCapacity(t.replace(/[^0-9]/g, ''))}
            />
          </View>
        </View>
        <View className="flex-row gap-3">
          <View style={{ flex: 2 }}>
            <Input
              label="Plate"
              placeholder="ABC 123"
              autoCapitalize="characters"
              autoCorrect={false}
              value={plate}
              onChangeText={(t) => setPlate(t.toUpperCase())}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Province"
              placeholder="AB"
              autoCapitalize="characters"
              maxLength={2}
              value={province}
              onChangeText={(t) => setProvince(t.toUpperCase().slice(0, 2))}
            />
          </View>
        </View>
      </View>

      <Pressable
        onPress={save}
        disabled={!valid}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          valid ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="add" size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">Add truck</Text>
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
