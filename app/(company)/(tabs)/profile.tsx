// =============================================================================
// /(company)/(tabs)/profile — company-side "Company" tab
//
// Every row is now a real, working entry point:
//   • Company Info        → EditCompanyInfoSheet  (legal/display/phone/email/HQ/trucks)
//   • Business Reg.       → EditBusinessRegistrationSheet  (reg# + doc upload)
//   • Insurance           → EditInsuranceSheet    (liability + fleet upload)
//   • Drivers / Trucks    → pushed Stack screens (full lists)
//   • Bank Account        → EditBankAccountSheet  (Canadian routing metadata)
//   • Invoices            → pushed payouts screen
//   • Safety              → pushed Safety Center
//   • Terms & Privacy     → external URL
//
// Editing happens via slide-up sheets (lightweight, no nav-stack churn)
// for short forms and via Stack pushes for list views — same split the
// customer profile uses.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CrewPortal } from '@/components/CrewPortal';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import {
  useMyMembership,
  useCompanyDriverRoster,
  useProfile,
  useCompany,
  useCompanyVehicles,
  useCompanyDocuments,
  useCompanyPayouts,
} from '@/lib/data';
import { useToast } from '@/components/Toast';
import { logout } from '@/lib/supabase';
import { NotificationBell } from '@/components/NotificationBell';
import { fmtPhone, fmtCurrency } from '@/lib/format';
import { EditCompanyInfoSheet } from '@/components/EditCompanyInfoSheet';
import { EditBusinessRegistrationSheet } from '@/components/EditBusinessRegistrationSheet';
import { EditInsuranceSheet } from '@/components/EditInsuranceSheet';
import { EditBankAccountSheet } from '@/components/EditBankAccountSheet';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  href?: string;
  onPress?: () => void;
};

export default function CompanyProfile() {
  const { data: profile } = useProfile();
  const { data: membership } = useMyMembership();
  const companyId = membership?.kind === 'company' ? membership.company_id : null;
  const { data: company } = useCompany(companyId);
  const { data: roster } = useCompanyDriverRoster(companyId);
  const { data: trucks } = useCompanyVehicles(companyId);
  const { data: docs } = useCompanyDocuments(companyId);
  const { data: payouts } = useCompanyPayouts(companyId);
  const toast = useToast();

  const [infoOpen, setInfoOpen] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [insOpen, setInsOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);

  const isDispatcher =
    membership?.kind === 'company' &&
    membership.org_role === 'admin';

  const companyName = company?.display_name ?? membership?.company_name ?? 'Your company';
  const initials = companyName
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const driverCount = roster?.length ?? 0;
  const onlineCount = roster?.filter((d) => d.is_online).length ?? 0;
  const truckCount = trucks?.length ?? 0;

  const liability = docs?.find((d) => d.kind === 'insurance');
  const fleet = docs?.find((d) => d.kind === 'fleet_insurance');
  const insuranceLabel = (() => {
    if (!liability && !fleet) return 'Upload docs';
    const both = liability?.status === 'approved' && fleet?.status === 'approved';
    if (both) return 'Approved';
    return 'In review';
  })();

  const regDoc = docs?.find((d) => d.kind === 'business_registration');
  const regLabel = company?.registration_number
    ? regDoc
      ? regDoc.status === 'approved'
        ? 'Approved'
        : 'In review'
      : 'No doc'
    : 'Add registration';

  const pendingPayoutCents =
    payouts
      ?.filter((p) => p.status === 'pending' || p.status === 'processing')
      .reduce((s, p) => s + (p.net_cents ?? 0), 0) ?? 0;
  const invoiceCount = payouts?.length ?? 0;

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: 'Company',
      rows: [
        {
          icon: 'business-outline',
          label: 'Company Info',
          value: companyName,
          onPress: () => setInfoOpen(true),
        },
        {
          icon: 'document-text-outline',
          label: 'Business Registration',
          value: regLabel,
          onPress: () => setRegOpen(true),
        },
        {
          icon: 'shield-checkmark-outline',
          label: 'Insurance',
          value: insuranceLabel,
          onPress: () => setInsOpen(true),
        },
      ],
    },
    {
      title: 'Fleet',
      rows: [
        {
          icon: 'people-outline',
          label: 'Drivers',
          value: `${onlineCount} online · ${driverCount} total`,
          href: '/(company)/drivers',
        },
        {
          icon: 'car-outline',
          label: 'Trucks',
          value: truckCount === 0 ? 'Add your first truck' : `${truckCount} on file`,
          href: '/(company)/trucks',
        },
      ],
    },
    {
      title: 'Payouts',
      rows: [
        {
          icon: 'card-outline',
          label: 'Bank Account',
          value: company?.bank_account_last4
            ? `•••• ${company.bank_account_last4}`
            : 'Add account',
          onPress: () => setBankOpen(true),
        },
        {
          icon: 'receipt-outline',
          label: 'Invoices',
          value:
            invoiceCount === 0
              ? 'None yet'
              : pendingPayoutCents > 0
              ? `${fmtCurrency(pendingPayoutCents / 100)} pending`
              : `${invoiceCount} total`,
          href: '/(company)/invoices',
        },
      ],
    },
    {
      title: 'Support',
      rows: [
        {
          icon: 'mail-outline',
          label: 'Contact Movvy Support',
          onPress: () =>
            Linking.openURL(
              `mailto:partner@movvy.ca?subject=Company%20support%20%E2%80%94%20${encodeURIComponent(
                companyName,
              )}`,
            ).catch(() => toast.error("Couldn't open mail.")),
        },
        {
          icon: 'shield-outline',
          label: 'Safety Center',
          href: '/(company)/safety',
        },
        {
          icon: 'document-outline',
          label: 'Terms & Privacy',
          onPress: () =>
            Linking.openURL('https://movvy.ca/legal').catch(() =>
              toast.error("Couldn't open the legal page."),
            ),
        },
      ],
    },
  ];

  const confirmLogout = () => {
    Alert.alert(
      'Log out?',
      "Drivers in your fleet will keep running, but you'll stop seeing live dispatch updates until you sign back in.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try { await logout(); } catch { /* noop */ }
            router.replace('/');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Company Profile"
          showBack={false}
          right={<NotificationBell href="/(company)/notifications" />}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Card>
          <View className="flex-row items-center">
            <View className="h-16 w-16 rounded-2xl bg-brand-600 items-center justify-center">
              <Text className="text-white text-2xl font-bold">{initials}</Text>
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-xl font-bold text-ink-900">{companyName}</Text>
              {company?.invite_code ? (
                <View className="mt-1 self-start">
                  <Badge label={`Code ${company.invite_code}`} tone="neutral" />
                </View>
              ) : null}
              {profile?.email ? (
                <Text className="text-[11px] text-silver-500 mt-1" numberOfLines={1}>
                  {profile.email}
                </Text>
              ) : null}
              {profile?.phone ? (
                <Text className="text-[11px] text-silver-500" numberOfLines={1}>
                  {fmtPhone(profile.phone)}
                </Text>
              ) : null}
            </View>
            {isDispatcher ? (
              <Pressable
                onPress={() => setInfoOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit company info"
                hitSlop={6}
                className="h-10 w-10 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
              >
                <Ionicons name="create-outline" size={18} color="#0A0A0A" />
              </Pressable>
            ) : null}
          </View>
        </Card>

        <CrewPortal />

        {sections.map((s) => (
          <View key={s.title}>
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
              {s.title}
            </Text>
            <Card padded={false}>
              {s.rows.map((r, i) => (
                <Pressable
                  key={r.label}
                  onPress={
                    r.onPress
                      ? r.onPress
                      : r.href
                      ? () => router.push(r.href as any)
                      : undefined
                  }
                  accessibilityRole="button"
                  accessibilityLabel={r.label}
                  className={`flex-row items-center px-5 py-4 active:opacity-70 ${
                    i < s.rows.length - 1 ? 'border-b border-silver-100' : ''
                  }`}
                >
                  <Ionicons name={r.icon} size={20} color="#0A0A0A" />
                  <Text className="ml-3 flex-1 text-base text-ink-900">{r.label}</Text>
                  {r.value ? (
                    <Text
                      className="mr-2 text-sm text-silver-500"
                      numberOfLines={1}
                      style={{ maxWidth: 180 }}
                    >
                      {r.value}
                    </Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}

        <Pressable
          onPress={confirmLogout}
          className="mt-6 h-14 items-center justify-center rounded-2xl bg-white border border-silver-300 active:opacity-70"
        >
          <Text className="text-base font-semibold text-danger">Log out</Text>
        </Pressable>

        <Text className="text-center text-xs text-silver-400 mt-6">Movvy v0.1.0 · Alberta-wide</Text>
      </ScrollView>

      {/* Editor sheets — all open as slide-up modals; closing returns the
          user to the same scroll position on the profile. No tab/stack
          switching, no transient "back" routing. */}
      <EditCompanyInfoSheet
        visible={infoOpen}
        companyId={companyId}
        onClose={() => setInfoOpen(false)}
      />
      <EditBusinessRegistrationSheet
        visible={regOpen}
        companyId={companyId}
        onClose={() => setRegOpen(false)}
      />
      <EditInsuranceSheet
        visible={insOpen}
        companyId={companyId}
        onClose={() => setInsOpen(false)}
      />
      <EditBankAccountSheet
        visible={bankOpen}
        companyId={companyId}
        onClose={() => setBankOpen(false)}
      />
    </SafeAreaView>
  );
}
