// =============================================================================
// /(mover)/(tabs)/profile — driver/mover "Driver Profile" tab
//
// Every row is now a real, working entry point:
//   • Personal info        → EditNameSheet         (profiles.full_name)
//   • Phone                → EditPhoneSheet        (OTP-verified profiles.phone)
//   • Email                → staticRow             (auth email change deferred)
//   • Vehicle              → EditDriverVehicleSheet (vehicles, owner-scoped)
//   • Documents            → EditDriverDocumentsSheet (re-upload any verification doc)
//   • Service area         → EditServiceAreaSheet  (partner_teams: city + radius)
//   • My availability      → /(mover)/availability  (existing)
//   • Crew                 → /(mover)/crew          (existing, operator only)
//   • Bank account         → EditTeamBankSheet     (partner_teams bank metadata)
//   • Tax info             → EditTaxInfoSheet      (partner_teams.gst_number)
//   • Refer a driver       → /(mover)/referrals    (existing)
//   • Safety               → /(mover)/safety        (new — mirrors company)
//   • Terms & Privacy      → https://movvy.ca/legal
//
// Operator-only sections (Crew, team Bank, team Tax, team Documents, Service
// area) are gated by `isOperator`. Hourly movers and company drivers see a
// trimmed list — they're paid through their team/company, not directly.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CrewPortal } from '@/components/CrewPortal';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import {
  useProfile,
  useMyMembership,
  useMyTeam,
  useTeam,
  useMyDriverVehicle,
  useMyDriverDocuments,
} from '@/lib/data';
import { useMyDriverStats } from '@/lib/data/usePartners';
import { ReviewFeed } from '@/components/ReviewFeed';
import { Skeleton } from '@/components/Skeleton';
import { NotificationBell } from '@/components/NotificationBell';
import { useToast } from '@/components/Toast';
import { logout, supabaseConfigured } from '@/lib/supabase';
import { fmtPhone } from '@/lib/format';
import { EditNameSheet } from '@/components/EditNameSheet';
import { EditPhoneSheet } from '@/components/EditPhoneSheet';
import { EditDriverVehicleSheet } from '@/components/EditDriverVehicleSheet';
import { EditDriverDocumentsSheet } from '@/components/EditDriverDocumentsSheet';
import { EditServiceAreaSheet } from '@/components/EditServiceAreaSheet';
import { EditTeamBankSheet } from '@/components/EditTeamBankSheet';
import { EditTaxInfoSheet } from '@/components/EditTaxInfoSheet';

interface Row {
  // Use keyof typeof Ionicons.glyphMap — the deep submodule path was wrong
  // and only worked through TypeScript's structural typing by accident; it
  // also breaks every time the icons package re-exports. This is the form
  // every other file in the app uses.
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** Route to push when tapped. */
  href?: string;
  /** Fully custom handler — used for mailto:, sheet openers, etc. */
  onPress?: () => void;
  /** Rows without an onPress / href aren't tappable. Hide the chevron so
   *  the affordance matches the behavior. */
  staticRow?: boolean;
}

export default function MoverProfile() {
  const { data: profile } = useProfile();
  const { data: stats, isLoading: statsLoading } = useMyDriverStats();
  const { data: membership } = useMyMembership();
  const toast = useToast();

  const displayName = profile?.full_name ?? 'Driver';
  // Format the rating: backend stores numeric(3,2). Show "—" if no ratings yet.
  const ratingText =
    stats?.rating_avg != null ? Number(stats.rating_avg).toFixed(1) : '—';
  const tripCount = stats?.trip_count ?? 0;
  const reviewCount = stats?.rating_count ?? 0;
  const isVerified = stats?.onboarding_status === 'verified';

  // Independent operators (a team's `driver`) get the same crew tools a company
  // owner has — an invite code + a Crew screen to add/manage hourly movers.
  // Movers and company drivers never see these.
  const isOperator = membership?.kind === 'team' && membership?.role === 'driver';
  const teamId = membership?.kind === 'team' ? membership.team_id : null;
  const { data: team } = useMyTeam(teamId);
  // Pull the wider team row so the rows can surface bank/tax/service-area status.
  const { data: teamFull } = useTeam(isOperator ? teamId : null);
  const { data: vehicle } = useMyDriverVehicle();
  const { data: docs } = useMyDriverDocuments(teamId);

  // ─── Sheet visibility ────────────────────────────────────────────────────
  const [nameOpen, setNameOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [serviceAreaOpen, setServiceAreaOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);

  // ─── Row labels — derived from live data ─────────────────────────────────
  const vehicleLabel = (() => {
    if (!vehicle) return 'Add your vehicle';
    const parts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean);
    return parts.length ? parts.join(' ') : `${vehicle.plate} · ${vehicle.province}`;
  })();

  const requiredDocs = ['gov_id', 'driver_license', 'selfie_with_id', 'insurance'];
  const approvedCount = docs?.filter(
    (d) => requiredDocs.includes(d.kind) && d.status === 'approved',
  ).length ?? 0;
  const uploadedCount = docs?.filter((d) => requiredDocs.includes(d.kind)).length ?? 0;
  const documentsLabel = (() => {
    if (uploadedCount === 0) return 'Upload required';
    if (approvedCount === requiredDocs.length) return 'Verified';
    if (uploadedCount === requiredDocs.length) return 'In review';
    return `${approvedCount}/${requiredDocs.length} approved`;
  })();

  const serviceAreaLabel = teamFull
    ? `${teamFull.service_radius_km} km radius`
    : 'Set city + radius';

  const bankLabel = teamFull?.bank_account_last4
    ? `•••• ${teamFull.bank_account_last4}`
    : 'Add account';

  const taxLabel = teamFull?.gst_number ? 'On file' : 'Add GST/HST';

  // ─── Sections ────────────────────────────────────────────────────────────
  //
  // Built per-render so onPress handlers can use the live toast / state.
  // For data we ALREADY have on file (name, phone, email, team), the row
  // value surfaces the live record so the driver can confirm what we've got
  // even when the row is just a viewer.
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: 'Driver Profile',
      rows: [
        {
          icon: 'person-outline',
          label: 'Personal info',
          value: profile?.full_name ?? '—',
          onPress: () => setNameOpen(true),
        },
        {
          icon: 'call-outline',
          label: 'Phone',
          value: profile?.phone ? fmtPhone(profile.phone) : 'Add phone',
          onPress: () => setPhoneOpen(true),
        },
        {
          // Auth email change is a multi-step Supabase flow we haven't wired
          // yet — surfacing a chevron + handler that does nothing would feel
          // broken. Mirror the customer-profile pattern: show the value, no
          // chevron, no press. Users can change it via support if needed.
          icon: 'mail-outline',
          label: 'Email',
          value: profile?.email ?? '—',
          staticRow: true,
        },
        {
          icon: 'car-outline',
          label: 'Vehicle',
          value: vehicleLabel,
          onPress: () => setVehicleOpen(true),
        },
        {
          icon: 'document-text-outline',
          label: 'Documents',
          value: documentsLabel,
          onPress: () => setDocumentsOpen(true),
        },
        // Service area is operator-only — hourly movers don't pick their own
        // city/radius, the team operator does it for them.
        ...(isOperator
          ? [
              {
                icon: 'map-outline' as const,
                label: 'Service area',
                value: serviceAreaLabel,
                onPress: () => setServiceAreaOpen(true),
              },
            ]
          : []),
        {
          icon: 'calendar-outline',
          label: 'My availability',
          value: 'Block days off',
          href: '/(mover)/availability',
        },
      ],
    },
    // Crew tools — operator only. A solo team driver can grow + manage their
    // crew of hourly movers, mirroring a company's driver roster.
    ...(isOperator
      ? [
          {
            title: 'Crew',
            rows: [
              {
                icon: 'people-outline' as const,
                label: 'Your crew',
                value: team?.invite_code ?? 'Manage',
                href: '/(mover)/crew',
              },
            ],
          },
        ]
      : []),
    {
      title: 'Payouts',
      rows: [
        // Bank + tax editors only make sense for operators — the payout
        // recipient. Hourly workers are paid through their team/company; we
        // tell them so instead of leaving an inert row.
        ...(isOperator
          ? [
              {
                icon: 'card-outline' as const,
                label: 'Bank account',
                value: bankLabel,
                onPress: () => setBankOpen(true),
              },
              {
                icon: 'receipt-outline' as const,
                label: 'Tax info',
                value: taxLabel,
                onPress: () => setTaxOpen(true),
              },
            ]
          : [
              {
                icon: 'card-outline' as const,
                label: 'Payouts',
                value:
                  membership?.kind === 'company'
                    ? 'Paid through your company'
                    : 'Paid through your team',
                staticRow: true,
              },
            ]),
        {
          icon: 'gift-outline',
          label: 'Refer a driver · $100 each',
          value: 'Earn',
          href: '/(mover)/referrals',
        },
      ],
    },
    {
      title: 'Support',
      rows: [
        {
          icon: 'mail-outline',
          label: 'Contact Movvy support',
          value: 'Email',
          onPress: () =>
            Linking.openURL(
              `mailto:support@movvy.ca?subject=Driver%20support%20%E2%80%94%20${encodeURIComponent(
                displayName,
              )}`,
            ).catch(() => toast.error("Couldn't open mail.")),
        },
        {
          icon: 'shield-outline',
          label: 'Safety Center',
          href: '/(mover)/safety',
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
      "If you're mid-shift, you'll stop receiving job offers until you sign back in.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try { await logout(); } catch {}
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
          title="Driver Profile"
          showBack={false}
          right={<NotificationBell href="/(mover)/notifications" />}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Card>
          <View className="flex-row items-center">
            <Avatar name={displayName} size={64} />
            <View className="ml-4 flex-1">
              <View className="flex-row items-center">
                <Text className="text-xl font-bold text-ink-900">{displayName}</Text>
                {isVerified ? (
                  <View className="ml-2 h-5 w-5 rounded-full bg-brand-50 items-center justify-center">
                    <Ionicons name="shield-checkmark" size={12} color="#047857" />
                  </View>
                ) : null}
              </View>
              <View className="flex-row items-center mt-0.5">
                <Ionicons name="star" size={14} color="#16A34A" />
                <Text className="ml-1 text-sm font-bold text-ink-900">{ratingText}</Text>
                <Text className="text-sm text-silver-500">
                  {' · '}
                  {tripCount} {tripCount === 1 ? 'trip' : 'trips'}
                </Text>
              </View>
              {stats?.team_name ? (
                <Text className="text-xs text-brand-700 font-semibold mt-1">{stats.team_name}</Text>
              ) : null}
              {/* Operators carry a shareable team code — same as a company. */}
              {isOperator && team?.invite_code ? (
                <View className="mt-1 self-start">
                  <Badge label={`Code ${team.invite_code}`} tone="neutral" />
                </View>
              ) : null}
              {/* Contact bits under the name — drivers + dispatchers often
                  want to confirm what email/phone they're registered with
                  (it's the same one customers can reach them on via the
                  Movvy proxy). */}
              {profile?.email || profile?.phone ? (
                <View className="mt-1">
                  {profile?.email ? (
                    <Text className="text-[11px] text-silver-500" numberOfLines={1}>
                      {profile.email}
                    </Text>
                  ) : null}
                  {profile?.phone ? (
                    <Text className="text-[11px] text-silver-500" numberOfLines={1}>
                      {fmtPhone(profile.phone)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* Inline edit pencil — fast path for renaming, same as customer
                + company profiles. Anyone with a profile row can use it. */}
            <Pressable
              onPress={() => setNameOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit name"
              hitSlop={6}
              className="h-10 w-10 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
            >
              <Ionicons name="create-outline" size={18} color="#0A0A0A" />
            </Pressable>
          </View>

          {/* Live rating stat — surfaces the customer-given average so the
              driver can see where they stand. Same number Movvy admin sees. */}
          <View className="mt-4 rounded-2xl bg-brand-50 border border-brand-100 p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center">
                  <Ionicons name="star" size={20} color="#fff" />
                </View>
                <View className="ml-3">
                  <Text className="text-xs text-silver-600">Your customer rating</Text>
                  {statsLoading ? (
                    <View style={{ marginTop: 6 }}>
                      <Skeleton width={84} height={22} />
                    </View>
                  ) : (
                    <Text className="text-2xl font-bold text-ink-900">
                      {ratingText}
                      <Text className="text-base text-silver-500"> / 5</Text>
                    </Text>
                  )}
                </View>
              </View>
              <View className="items-end">
                <Text className="text-xs text-silver-500">Based on</Text>
                <Text className="text-sm font-bold text-ink-900">
                  {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
                </Text>
              </View>
            </View>
            {!supabaseConfigured ? (
              <Text className="mt-2 text-[11px] text-silver-500">
                Live stats activate once the backend is connected.
              </Text>
            ) : reviewCount === 0 ? (
              <Text className="mt-2 text-[11px] text-silver-500">
                Your average will appear here as soon as you complete moves and customers rate you.
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Public review feed — same rows other customers will see when we
            expose partner-profile pages. Drivers get direct visibility into
            what customers are saying about them. */}
        {reviewCount > 0 ? (
          <View className="mt-6">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2 px-1">
              What customers say
            </Text>
            <ReviewFeed
              teamId={membership?.kind === 'team' ? membership.team_id : null}
              companyId={membership?.kind === 'company' ? membership.company_id : null}
              limit={5}
              showHeader={false}
            />
          </View>
        ) : null}

        <CrewPortal />

        {sections.map((s) => (
          <View key={s.title}>
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
              {s.title}
            </Text>
            <Card padded={false}>
              {s.rows.map((r, i) => {
                const interactive = !r.staticRow && (!!r.onPress || !!r.href);
                const RowComp: any = interactive ? Pressable : View;
                return (
                  <RowComp
                    key={r.label}
                    onPress={
                      interactive
                        ? r.onPress
                          ? r.onPress
                          : () => router.push(r.href as any)
                        : undefined
                    }
                    accessibilityRole={interactive ? 'button' : undefined}
                    accessibilityLabel={r.label}
                    className={`flex-row items-center px-5 py-4 ${
                      i < s.rows.length - 1 ? 'border-b border-silver-100' : ''
                    } ${interactive ? 'active:opacity-70' : ''}`}
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
                    {/* Chevron only when the row navigates somewhere — chevron-
                        with-no-action is a classic "looks broken" tell. */}
                    {interactive ? (
                      <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
                    ) : null}
                  </RowComp>
                );
              })}
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
          switching, no transient "back" routing. Operator-only sheets pass
          teamId — null is a safe no-op (the read hook just returns null). */}
      <EditNameSheet visible={nameOpen} onClose={() => setNameOpen(false)} />
      <EditPhoneSheet visible={phoneOpen} onClose={() => setPhoneOpen(false)} />
      <EditDriverVehicleSheet
        visible={vehicleOpen}
        onClose={() => setVehicleOpen(false)}
      />
      <EditDriverDocumentsSheet
        visible={documentsOpen}
        teamId={teamId}
        onClose={() => setDocumentsOpen(false)}
      />
      <EditServiceAreaSheet
        visible={serviceAreaOpen}
        teamId={teamId}
        onClose={() => setServiceAreaOpen(false)}
      />
      <EditTeamBankSheet
        visible={bankOpen}
        teamId={teamId}
        onClose={() => setBankOpen(false)}
      />
      <EditTaxInfoSheet
        visible={taxOpen}
        teamId={teamId}
        onClose={() => setTaxOpen(false)}
      />
    </SafeAreaView>
  );
}
