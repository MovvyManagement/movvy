// =============================================================================
// EditDriverVehicleSheet
//
// Driver-side vehicle editor. Writes a row in `vehicles` scoped to the
// signed-in driver via owner_profile_id — same pattern the company-side
// AddTruckSheet uses, but the row is owned by the profile rather than the
// company. Used from the mover profile's "Vehicle" row.
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
import {
  useMyDriverVehicle,
  useSaveMyDriverVehicle,
  type DriverVehicleRow,
} from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

const TYPES: { key: DriverVehicleRow['type']; label: string; sub: string }[] = [
  { key: 'cargo_van', label: 'Cargo van', sub: 'Studio + 1-bed apt' },
  { key: 'cube_van_16', label: '16 ft cube', sub: '2-bed apt or condo' },
  { key: 'box_truck_24', label: '24 ft box', sub: '3-bed home' },
  { key: 'box_truck_26', label: '26 ft box', sub: '4-bed home' },
  { key: 'pickup_truck', label: 'Pickup', sub: 'Single items / labor only' },
  { key: 'other', label: 'Other', sub: 'Trailer, etc.' },
];

export function EditDriverVehicleSheet({ visible, onClose }: Props) {
  const { data: vehicle } = useMyDriverVehicle();
  const save = useSaveMyDriverVehicle();
  const toast = useToast();

  const [type, setType] = useState<DriverVehicleRow['type']>('cube_van_16');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [province, setProvince] = useState('AB');
  const [capacity, setCapacity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (vehicle) {
      setType(vehicle.type);
      setMake(vehicle.make ?? '');
      setModel(vehicle.model ?? '');
      setYear(vehicle.year ? String(vehicle.year) : '');
      setPlate(vehicle.plate);
      setProvince(vehicle.province);
      setCapacity(vehicle.capacity_cu_ft ? String(vehicle.capacity_cu_ft) : '');
    } else {
      setType('cube_van_16');
      setMake('');
      setModel('');
      setYear('');
      setPlate('');
      setProvince('AB');
      setCapacity('');
    }
  }, [visible, vehicle]);

  const valid =
    !saving &&
    make.trim().length >= 2 &&
    model.trim().length >= 1 &&
    plate.trim().length >= 2 &&
    /^[A-Z]{2}$/.test(province.trim().toUpperCase()) &&
    (year === '' || /^[0-9]{4}$/.test(year));

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await save.mutateAsync({
        id: vehicle?.id,
        type,
        make: make.trim(),
        model: model.trim(),
        year: year ? Number(year) : null,
        plate: plate.trim(),
        province: province.trim().toUpperCase(),
        capacity_cu_ft: capacity ? Number(capacity) : null,
      });
      haptic.success();
      toast.success(vehicle ? 'Vehicle updated' : 'Vehicle saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save your vehicle.");
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

      <Text className="text-2xl font-bold text-ink-900">Your vehicle</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Customers see your vehicle size when their booking is matched. Movvy
        verifies registration on file — change the plate or province here if
        you switch vehicles.
      </Text>

      <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
        Size
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {TYPES.map((t) => {
          const active = t.key === type;
          return (
            <Pressable
              key={t.key}
              onPress={() => setType(t.key)}
              className={`px-3 py-2 rounded-2xl border ${
                active ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
              }`}
              accessibilityRole="button"
              accessibilityLabel={t.label}
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
        onPress={submit}
        disabled={!valid}
        className={`mt-6 h-14 rounded-2xl items-center justify-center flex-row ${
          valid ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name={vehicle ? 'checkmark' : 'add'} size={18} color="#fff" />
            <Text className="ml-2 text-base font-bold text-white">
              {vehicle ? 'Save changes' : 'Save vehicle'}
            </Text>
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
