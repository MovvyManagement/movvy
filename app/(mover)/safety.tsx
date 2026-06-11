// =============================================================================
// /(mover)/safety — Driver Safety Center
//
// Mirror of /(company)/safety, scoped to the partner-team driver. Single hub
// for everything safety-related:
//   • SOS: 911 + Movvy support hotline
//   • Emergency contact (reuses EmergencyContactSheet — same widget the
//     customer profile uses)
//   • Coverage status (vehicle insurance — pulled from useMyDriverDocuments)
//   • Safety resources (handbook, incident report, training videos)
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmergencyContactSheet } from '@/components/EmergencyContactSheet';
import { NotificationBell } from '@/components/NotificationBell';
import {
  useProfile,
  useMyMembership,
  useMyDriverDocuments,
  useMyDriverStats,
} from '@/lib/data';
import { fmtPhone } from '@/lib/format';

export default function MoverSafety() {
  const { data: profile } = useProfile();
  const { data: membership } = useMyMembership();
  const { data: stats } = useMyDriverStats();
  const teamId = membership?.kind === 'team' ? membership.team_id : null;
  const { data: docs } = useMyDriverDocuments(teamId);

  const [contactOpen, setContactOpen] = useState(false);

  const insurance = docs?.find((d) => d.kind === 'insurance');
  const license = docs?.find((d) => d.kind === 'driver_license');
  const fullyInsured =
    insurance?.status === 'approved' && license?.status === 'approved';

  const callMovvy = () => {
    // Same placeholder hotline the company-side safety screen uses — swap to
    // the real number once it's set.
    Linking.openURL('tel:+18336668891').catch(() =>
      Alert.alert("Couldn't open dialer"),
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Safety Center"
          subtitle={stats?.team_name ?? membership?.team_name ?? undefined}
          showBack
          right={<NotificationBell href="/(mover)/notifications" />}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* SOS hero — 911 + Movvy support */}
        <Card>
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-red-50 items-center justify-center">
              <Ionicons name="warning" size={22} color="#EF4444" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">In a real emergency</Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                Always call 911 first. Movvy support comes next.
              </Text>
            </View>
          </View>
          <View className="flex-row gap-3 mt-3">
            <Pressable
              onPress={() => Linking.openURL('tel:911').catch(() => null)}
              className="flex-1 h-12 rounded-2xl bg-danger items-center justify-center active:opacity-90"
              accessibilityRole="button"
              accessibilityLabel="Call 911"
            >
              <Text className="text-white text-base font-bold">Call 911</Text>
            </Pressable>
            <Pressable
              onPress={callMovvy}
              className="flex-1 h-12 rounded-2xl border border-ink-900 items-center justify-center active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="Call Movvy support"
            >
              <Text className="text-base font-bold text-ink-900">Call Movvy</Text>
            </Pressable>
          </View>
        </Card>

        {/* Emergency contact — same widget the customer profile uses */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Emergency contact
        </Text>
        <Card padded={false}>
          <Pressable
            onPress={() => setContactOpen(true)}
            className="flex-row items-center px-5 py-4 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Edit emergency contact"
          >
            <Ionicons name="people-outline" size={20} color="#0A0A0A" />
            <View className="ml-3 flex-1">
              <Text className="text-base text-ink-900">
                {profile?.emergency_contact_name ?? 'Add someone we can reach'}
              </Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                {profile?.emergency_contact_phone
                  ? fmtPhone(profile.emergency_contact_phone)
                  : 'Movvy texts them only if you trigger SOS'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
          </Pressable>
        </Card>

        {/* Coverage status — driver license + vehicle insurance */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Coverage
        </Text>
        <Card>
          <View className="flex-row items-center">
            <View
              className={`h-12 w-12 rounded-2xl items-center justify-center ${
                fullyInsured ? 'bg-brand-50' : 'bg-amber-50'
              }`}
            >
              <Ionicons
                name={fullyInsured ? 'shield-checkmark' : 'shield-outline'}
                size={22}
                color={fullyInsured ? '#047857' : '#F59E0B'}
              />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">
                {fullyInsured ? 'Fully verified' : 'Coverage pending'}
              </Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                Both your license and vehicle insurance must be approved by Movvy.
              </Text>
            </View>
          </View>
          <View className="mt-3 gap-2">
            <CoverageRow label="Driver license" status={license?.status} />
            <CoverageRow label="Vehicle insurance" status={insurance?.status} />
          </View>
        </Card>

        {/* Safety resources */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Resources
        </Text>
        <Card padded={false}>
          <ResourceRow
            icon="document-text-outline"
            label="Crew safety handbook"
            onPress={() =>
              Linking.openURL('https://movvy.ca/safety').catch(() =>
                Alert.alert("Couldn't open the safety handbook."),
              )
            }
          />
          <ResourceRow
            icon="mail-outline"
            label="Report an incident"
            onPress={() =>
              Linking.openURL(
                'mailto:safety@movvy.ca?subject=Incident%20report',
              ).catch(() => null)
            }
            border
          />
          <ResourceRow
            icon="help-circle-outline"
            label="Driver training videos"
            onPress={() =>
              Linking.openURL('https://movvy.ca/training').catch(() => null)
            }
            border
          />
        </Card>
      </ScrollView>

      <EmergencyContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} />
    </SafeAreaView>
  );
}

function CoverageRow({
  label,
  status,
}: {
  label: string;
  status?: string;
}) {
  const tone =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
      ? 'danger'
      : status === 'expired'
      ? 'warning'
      : status
      ? 'warning'
      : 'neutral';
  const display = status
    ? status === 'approved'
      ? 'Approved'
      : status === 'rejected'
      ? 'Rejected'
      : status === 'expired'
      ? 'Expired'
      : 'In review'
    : 'Not uploaded';
  return (
    <View className="flex-row items-center">
      <Text className="flex-1 text-sm text-ink-900">{label}</Text>
      <Badge label={display} tone={tone as any} />
    </View>
  );
}

function ResourceRow({
  icon,
  label,
  onPress,
  border,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  border?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-5 py-4 active:opacity-70 ${
        border ? 'border-t border-silver-100' : ''
      }`}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color="#0A0A0A" />
      <Text className="ml-3 flex-1 text-base text-ink-900">{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
    </Pressable>
  );
}
