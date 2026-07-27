// =============================================================================
// EditCompanyInfoSheet
//
// Multi-field editor for the company's public-facing identity. Lets the
// owner / dispatcher change legal + display name, phone, email, HQ address,
// and active truck count. Backed by useCompany / useUpdateCompany so the
// dashboard greeting + tab title pick the new name up on the next render.
//
// HQ address is changed via AddressAutocomplete (Alberta-wide); only the
// coords + line1 are reset when a new place is picked — region / postal
// are filled from the suggestion when present, otherwise left alone.
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
import { AddressAutocomplete } from './AddressAutocomplete';
import { useCompany, useUpdateCompany } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import type { GeocodeResult } from '@/lib/geocoding';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function EditCompanyInfoSheet({ visible, companyId, onClose }: Props) {
  const { data: company } = useCompany(companyId);
  const update = useUpdateCompany(companyId);
  const toast = useToast();

  const [legal, setLegal] = useState('');
  const [display, setDisplay] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [truckCount, setTruckCount] = useState('');

  const [hqText, setHqText] = useState('');
  const [hqPick, setHqPick] = useState<GeocodeResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !company) return;
    setLegal(company.legal_name ?? '');
    setDisplay(company.display_name ?? '');
    setPhone(company.phone ?? '');
    setEmail(company.email ?? '');
    setTruckCount(String(company.truck_count ?? 0));
    setHqText(company.hq_line1 ?? '');
    setHqPick(null);
  }, [visible, company]);

  const canSave =
    !!company &&
    !saving &&
    legal.trim().length >= 2 &&
    display.trim().length >= 2 &&
    /^\+[1-9]\d{6,14}$/.test(phone.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    // Allow 0 trucks — a solo mover or a company that hasn't added trucks yet is
    // valid. Requiring >=1 silently disabled the whole Save button (incl. HQ
    // address changes) for any org showing "0 active trucks".
    Number.isFinite(Number(truckCount)) &&
    Number(truckCount) >= 0 &&
    Number(truckCount) <= 200;

  const save = async () => {
    if (!canSave || !company) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        legal_name: legal.trim(),
        display_name: display.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        truck_count: Number(truckCount),
      };

      // Only overwrite the HQ block if the user picked a new suggestion —
      // typing without selecting from the dropdown is preserved as line1
      // so the user can still hand-correct an apartment number etc.
      if (hqPick) {
        const secondary = hqPick.secondary ?? '';
        const parts = secondary.split('·').map((s) => s.trim()).filter(Boolean);
        patch.hq_line1 = hqPick.label;
        patch.hq_lat = hqPick.lat;
        patch.hq_lng = hqPick.lng;
        if (parts.length) patch.hq_city_name = parts[0];
        if (parts.length >= 3) patch.hq_postal = parts[parts.length - 1];
      } else if (hqText.trim() && hqText.trim() !== (company.hq_line1 ?? '')) {
        patch.hq_line1 = hqText.trim();
      }

      await update.mutateAsync(patch);
      haptic.success();
      toast.success('Company info saved');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save your changes.");
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

      <Text className="text-2xl font-bold text-ink-900">Company info</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Customers see your display name on bookings and chat. Legal name
        and registration are used on receipts + invoices.
      </Text>

      <View className="mt-5 gap-3">
        <Input
          label="Display name"
          placeholder="Movvy Movers"
          autoCapitalize="words"
          value={display}
          onChangeText={setDisplay}
          leftIcon={<Ionicons name="storefront-outline" size={18} color="#71717A" />}
        />
        <Input
          label="Legal name"
          placeholder="Movvy Movers Ltd."
          autoCapitalize="words"
          value={legal}
          onChangeText={setLegal}
          leftIcon={<Ionicons name="business-outline" size={18} color="#71717A" />}
        />
        <Input
          label="Phone"
          placeholder="+14035551234"
          keyboardType="phone-pad"
          autoCorrect={false}
          value={phone}
          onChangeText={setPhone}
          leftIcon={<Ionicons name="call-outline" size={18} color="#71717A" />}
          hint="Use E.164 format. Customers can mask-call this number during a move."
        />
        <Input
          label="Email"
          placeholder="dispatch@yourcompany.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          leftIcon={<Ionicons name="mail-outline" size={18} color="#71717A" />}
        />
        <Input
          label="Active trucks"
          placeholder="4"
          keyboardType="number-pad"
          value={truckCount}
          onChangeText={(t) => setTruckCount(t.replace(/[^0-9]/g, ''))}
          leftIcon={<Ionicons name="car-outline" size={18} color="#71717A" />}
          hint="How many trucks you can roll today. Used to flag capacity warnings on the dashboard."
        />

        <View>
          <Text className="mb-2 text-sm font-semibold text-ink-900">HQ address</Text>
          <AddressAutocomplete
            placeholder="Start typing your HQ address"
            value={hqText}
            onChangeText={(t) => {
              setHqText(t);
              if (hqPick && t !== hqPick.label) setHqPick(null);
            }}
            onSelect={(r) => {
              setHqPick(r);
              setHqText(r.label);
            }}
            leftDotColor="#16A34A"
          />
          <Text className="mt-1 text-xs text-silver-500">
            Travel time + long-haul surcharge are billed from this address.
          </Text>
        </View>
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
            <Text className="ml-2 text-base font-bold text-white">Save changes</Text>
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
