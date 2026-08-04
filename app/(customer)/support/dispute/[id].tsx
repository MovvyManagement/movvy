// =============================================================================
// /(customer)/support/dispute/[id] — formal dispute form
//
// Damage, theft, no-show, overcharge, poor service. Uses the existing
// disputes-open edge fn with photo evidence attached via documents-upload-url.
// Submitting writes a dispute row + audit_log entry + (later) Movvy support
// reaches out via the customer's chat thread.
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
import { useBooking, useSubmitFullDispute, useUploadDocument } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

type Kind = 'damage' | 'late' | 'no_show' | 'poor_service' | 'overcharge' | 'other';
type Severity = 'low' | 'medium' | 'high';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const KINDS: { key: Kind; label: string; icon: IoniconName }[] = [
  { key: 'damage', label: 'Damage / theft', icon: 'alert-circle' },
  { key: 'late', label: 'Crew was late', icon: 'time' },
  { key: 'no_show', label: 'Crew never showed', icon: 'close-circle' },
  { key: 'poor_service', label: 'Poor service', icon: 'thumbs-down' },
  { key: 'overcharge', label: 'Overcharged', icon: 'cash' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle' },
];

const SEVERITIES: { key: Severity; label: string; hint: string }[] = [
  { key: 'low', label: 'Minor', hint: 'A small issue, no urgency.' },
  { key: 'medium', label: 'Significant', hint: 'Needs review this week.' },
  { key: 'high', label: 'Severe', hint: 'Damage or safety, urgent.' },
];

export default function DisputeForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, isLoading } = useBooking(id);
  const open = useSubmitFullDispute();
  const upload = useUploadDocument();
  const toast = useToast();

  const [kind, setKind] = useState<Kind>('damage');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [summary, setSummary] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const pickPhotos = async () => {
    if (!booking) return;
    try {
      const ImagePicker = await import('expo-image-picker');
      // Android only — on iOS the permission prompt opens the limited-library
      // management sheet and the picker never returns a file.
      if (Platform.OS === 'android') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          toast.error('Photo permission needed to attach evidence.');
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: 6,
      });
      if (res.canceled || !res.assets?.length) return;
      setUploading(true);
      for (const asset of res.assets) {
        const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        try {
          const r = await upload.mutateAsync({
            bucket: 'move-photos',
            subject_type: 'booking',
            subject_id: booking.id,
            fileUri: asset.uri,
            fileName: `dispute-${Date.now()}.${ext}`,
            mimeType: asset.mimeType ?? 'image/jpeg',
          });
          setPhotos((p) => [...p, r.path]);
        } catch (e: any) {
          toast.error(e?.message ?? "Couldn't attach photo.");
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
        'Describe what happened so support can act fast. At least 20 characters.',
      );
      return;
    }
    try {
      const res = await open.mutateAsync({
        booking_id: booking.id,
        kind,
        severity,
        summary,
        photoPaths: photos,
      });
      haptic.success();
      Alert.alert(
        'Dispute submitted',
        `Dispute #${res.dispute.id.slice(0, 8)} is being reviewed. Movvy support will respond within 48 hours.`,
        [{ text: 'Done', onPress: () => router.replace('/(customer)/support') }],
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't submit dispute.");
    }
  };

  if (isLoading || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Open a dispute" />
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
        <ScreenHeader title="Open a dispute" subtitle={`#${booking.short_code}`} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
              Move
            </Text>
            <Text className="mt-1 text-sm font-bold text-ink-900" numberOfLines={1}>
              {booking.pickup_line1} → {booking.dropoff_line1 ?? 'in-home'}
            </Text>
          </Card>

          {/* Kind */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {KINDS.map((k) => {
              const sel = k.key === kind;
              return (
                <Pressable
                  key={k.key}
                  onPress={() => setKind(k.key)}
                  className={`rounded-2xl border px-3 py-2.5 flex-row items-center active:opacity-80 ${
                    sel ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                  }`}
                >
                  <Ionicons name={k.icon} size={14} color={sel ? '#047857' : '#52525B'} />
                  <Text
                    className={`ml-1.5 text-xs font-semibold ${
                      sel ? 'text-brand-700' : 'text-ink-900'
                    }`}
                  >
                    {k.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Severity */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            How severe?
          </Text>
          <View className="flex-row gap-2">
            {SEVERITIES.map((s) => {
              const sel = s.key === severity;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setSeverity(s.key)}
                  className={`flex-1 rounded-2xl border p-3 active:opacity-80 ${
                    sel
                      ? s.key === 'high'
                        ? 'border-danger bg-red-50'
                        : 'border-brand-600 bg-brand-50'
                      : 'border-silver-200 bg-white'
                  }`}
                >
                  <Text
                    className={`text-sm font-bold ${
                      sel
                        ? s.key === 'high'
                          ? 'text-danger'
                          : 'text-brand-700'
                        : 'text-ink-900'
                    }`}
                  >
                    {s.label}
                  </Text>
                  <Text className="text-[10px] text-silver-500 mt-0.5">{s.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Summary */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            What happened?
          </Text>
          <View className="rounded-2xl border border-silver-200 bg-white p-3">
            <TextInput
              value={summary}
              onChangeText={setSummary}
              placeholder="Walk through what happened, when, and what outcome you'd like."
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

          {/* Photos */}
          <Text className="mt-5 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Photo evidence (optional but speeds review)
          </Text>
          {photos.length > 0 ? (
            <View className="rounded-2xl border border-silver-200 bg-white p-3">
              <Text className="text-sm font-bold text-ink-900">
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'} attached
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
        </ScrollView>

        <View
          className="px-5 pt-3 border-t border-silver-100 bg-white"
          style={{ paddingBottom: 28 }}
        >
          <Button
            label="Submit dispute"
            size="lg"
            fullWidth
            loading={open.isPending}
            disabled={summary.trim().length < 20}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
