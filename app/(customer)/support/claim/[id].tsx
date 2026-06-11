// =============================================================================
// /(customer)/support/claim/[id] — insurance claim form
//
// Files a dispute with kind='insurance_claim'. The customer attaches:
//   • a description
//   • damaged-items shortlist with estimated values
//   • photos (uploaded to the move-photos bucket via documents-upload-url)
//
// Server-side this becomes a single dispute row; admin reviews it from the
// existing disputes inbox. Photos get a path-listed link inside the
// dispute summary so the admin can pull them up via Storage.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useBooking, useSubmitInsuranceClaim, useUploadDocument } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

interface ItemRow {
  id: string;
  label: string;
  estimatedValueDollars: number;
}

export default function ClaimForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, isLoading } = useBooking(id);
  const claim = useSubmitInsuranceClaim();
  const upload = useUploadDocument();
  const toast = useToast();

  const [summary, setSummary] = useState('');
  const [items, setItems] = useState<ItemRow[]>([
    { id: 'i1', label: '', estimatedValueDollars: 0 },
  ]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const addItem = () =>
    setItems((s) => [
      ...s,
      { id: `i${s.length + 1}_${Math.random().toString(36).slice(2, 6)}`, label: '', estimatedValueDollars: 0 },
    ]);
  const removeItem = (rowId: string) =>
    setItems((s) => (s.length > 1 ? s.filter((r) => r.id !== rowId) : s));
  const updateItem = (rowId: string, patch: Partial<ItemRow>) =>
    setItems((s) => s.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));

  const totalEstimate = items.reduce((acc, i) => acc + (Number(i.estimatedValueDollars) || 0), 0);

  const pickPhotos = async () => {
    if (!booking) return;
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        toast.error('Photo permission needed to attach evidence.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: 6,
      });
      if (res.canceled || !res.assets?.length) return;
      setUploading(true);
      for (const asset of res.assets) {
        const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        try {
          const result = await upload.mutateAsync({
            bucket: 'move-photos',
            subject_type: 'booking',
            subject_id: booking.id,
            fileUri: asset.uri,
            fileName: `claim-${Date.now()}.${ext}`,
            mimeType: asset.mimeType ?? 'image/jpeg',
          });
          setPhotos((p) => [...p, result.path]);
        } catch (e: any) {
          toast.error(e?.message ?? `Could not upload ${ext}.`);
        }
      }
      setUploading(false);
      haptic.success();
    } catch (e: any) {
      setUploading(false);
      toast.error(e?.message ?? "Couldn't open photo picker.");
    }
  };

  const submit = async () => {
    if (!booking) return;
    if (summary.trim().length < 20) {
      Alert.alert(
        'Add more detail',
        'Describe what was damaged or missing so the team can investigate. At least 20 characters.',
      );
      return;
    }
    try {
      const res = await claim.mutateAsync({
        booking_id: booking.id,
        summary,
        items: items
          .filter((i) => i.label.trim() && (Number(i.estimatedValueDollars) || 0) > 0)
          .map((i) => ({
            label: i.label.trim(),
            estimatedValueDollars: Number(i.estimatedValueDollars),
          })),
        photoPaths: photos,
      });
      haptic.success();
      Alert.alert(
        'Claim submitted',
        `Claim #${res.dispute.id.slice(0, 8)} is in the queue. Movvy support will reach out within 24 hours.`,
        [{ text: 'Done', onPress: () => router.replace('/(customer)/support') }],
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't submit your claim.");
    }
  };

  if (isLoading || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Insurance claim" />
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-silver-500">Loading booking…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Insurance claim" subtitle={`#${booking.short_code}`} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Move snapshot — confirms exactly what they're claiming against */}
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
              Move
            </Text>
            <Text className="mt-1 text-sm font-bold text-ink-900" numberOfLines={1}>
              {booking.pickup_line1} → {booking.dropoff_line1 ?? 'in-home'}
            </Text>
            <Text className="text-[11px] text-silver-500 mt-0.5">
              Completed · #{booking.short_code}
            </Text>
          </Card>

          {/* Summary */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            What happened?
          </Text>
          <View className="rounded-2xl border border-silver-200 bg-white p-3">
            <TextInput
              value={summary}
              onChangeText={setSummary}
              placeholder="Be specific: what was damaged or missing, when you noticed, and how. The more detail, the faster we can process."
              placeholderTextColor="#A1A1AA"
              multiline
              maxLength={2000}
              className="text-base text-ink-900"
              style={{ minHeight: 110, textAlignVertical: 'top' }}
            />
          </View>
          <Text className="mt-1 text-[10px] text-silver-400 text-right">
            {summary.length}/2000
          </Text>

          {/* Items */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Damaged or missing items
          </Text>
          {items.map((row, idx) => (
            <View
              key={row.id}
              className="rounded-2xl border border-silver-200 bg-white p-3 mb-2"
            >
              <View className="flex-row items-center mb-2">
                <Text className="text-xs font-bold text-ink-900">Item {idx + 1}</Text>
                {items.length > 1 ? (
                  <Pressable
                    onPress={() => removeItem(row.id)}
                    hitSlop={8}
                    className="ml-auto"
                  >
                    <Ionicons name="close-circle" size={18} color="#A1A1AA" />
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                value={row.label}
                onChangeText={(v) => updateItem(row.id, { label: v })}
                placeholder="e.g. Walnut dining table"
                placeholderTextColor="#A1A1AA"
                className="rounded-xl bg-silver-50 px-3 py-2.5 text-sm text-ink-900"
              />
              <View className="mt-2 rounded-xl bg-silver-50 px-3 flex-row items-center">
                <Text className="text-sm font-bold text-silver-500">$</Text>
                <TextInput
                  value={row.estimatedValueDollars > 0 ? String(row.estimatedValueDollars) : ''}
                  onChangeText={(v) =>
                    updateItem(row.id, {
                      estimatedValueDollars: Number(v.replace(/[^\d.]/g, '')) || 0,
                    })
                  }
                  placeholder="Estimated value"
                  placeholderTextColor="#A1A1AA"
                  keyboardType="decimal-pad"
                  className="flex-1 ml-2 py-2.5 text-sm text-ink-900"
                />
              </View>
            </View>
          ))}
          <Pressable
            onPress={addItem}
            className="rounded-2xl border border-dashed border-silver-300 p-3 flex-row items-center justify-center active:opacity-80"
          >
            <Ionicons name="add-circle-outline" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">Add another item</Text>
          </Pressable>
          {totalEstimate > 0 ? (
            <Text className="mt-2 text-[11px] text-silver-500 text-right">
              Claim total estimate · ${totalEstimate.toFixed(2)}
              {totalEstimate > 5000 ? ' (above coverage cap)' : ''}
            </Text>
          ) : null}

          {/* Photos */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Photo evidence
          </Text>
          {photos.length > 0 ? (
            <View className="rounded-2xl border border-silver-200 bg-white p-3">
              <Text className="text-sm font-bold text-ink-900">
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'} attached
              </Text>
              <Text className="text-[11px] text-silver-500 mt-0.5">
                Stored against this booking. Admin will pull them via Movvy storage.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={pickPhotos}
            disabled={uploading}
            className="mt-2 rounded-2xl border border-dashed border-silver-300 p-3 flex-row items-center justify-center active:opacity-80"
          >
            <Ionicons name="camera-outline" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">
              {uploading
                ? 'Uploading…'
                : photos.length === 0
                ? 'Add photos'
                : 'Add more photos'}
            </Text>
          </Pressable>

          <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row items-start">
            <Ionicons name="information-circle-outline" size={16} color="#71717A" />
            <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
              Coverage caps at $5,000 per move. Movvy verifies via your
              booking record + the crew's report; if the dollar values look
              off, support will reach out for documentation.
            </Text>
          </View>
        </ScrollView>

        <View
          className="px-5 pt-3 border-t border-silver-100 bg-white"
          style={{ paddingBottom: 28 }}
        >
          <Button
            label="Submit claim"
            size="lg"
            fullWidth
            loading={claim.isPending}
            disabled={summary.trim().length < 20}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
