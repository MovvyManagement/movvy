import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { logout, supabaseConfigured, useAuth } from '@/lib/supabase';
import { useProfile, usePaymentMethods, useSavedAddresses } from '@/lib/data';
import { MaxWidth } from '@/components/MaxWidth';
import { EditNameSheet } from '@/components/EditNameSheet';
import { EditPhoneSheet } from '@/components/EditPhoneSheet';
import { DeleteAccountSheet } from '@/components/DeleteAccountSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { useToast } from '@/components/Toast';
import { fmtPhone } from '@/lib/format';

interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  /** Rows without an onPress aren't tappable — we hide the chevron so the
   *  affordance matches the behaviour. Email is the canonical example. */
  staticRow?: boolean;
}

export default function Profile() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const { data: cards } = usePaymentMethods();
  const { data: addresses } = useSavedAddresses();
  const toast = useToast();

  // Slide-up sheets for the editable account rows. Kept here (not as nested
  // screens) so the profile feels lightweight — opening / closing a sheet
  // doesn't push onto the nav stack.
  const [editNameOpen, setEditNameOpen] = React.useState(false);
  const [editPhoneOpen, setEditPhoneOpen] = React.useState(false);
  // Account deletion runs through DeleteAccountSheet — the old flow used
  // Alert.prompt, which is iOS-only, so Android customers could never
  // complete the type-to-confirm step (a Google Play policy requirement).
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  // Fallback display values for the not-yet-wired demo case.
  const displayName = profile?.full_name ?? (user?.user_metadata as any)?.full_name ?? 'Welcome';
  const email = profile?.email ?? user?.email ?? 'Sign in to load profile';
  // Phone always rendered to humans in NANP format — never the raw +1XXXYYYZZZZ
  // we store in profiles.phone.
  const phone = profile?.phone ? fmtPhone(profile.phone) : 'Add a phone number';

  // Account rows. Every row in this section is either interactive (chevron,
  // onPress) or explicitly marked staticRow (no chevron, no press handler).
  // Email is staticRow because changing the auth email is a multi-step
  // Supabase flow we haven't wired yet — surfacing a tappable chevron that
  // does nothing would feel broken.
  const account: Row[] = [
    {
      icon: 'person-outline',
      label: 'Personal info',
      value: displayName,
      onPress: () => setEditNameOpen(true),
    },
    {
      icon: 'mail-outline',
      label: 'Email',
      value: email,
      staticRow: true,
    },
    {
      icon: 'call-outline',
      label: 'Phone',
      value: phone,
      onPress: () => setEditPhoneOpen(true),
    },
    {
      icon: 'location-outline',
      label: 'Saved addresses',
      // Live count from useSavedAddresses — empty state nudges the user to
      // add their first one, the count tells repeat customers what they have.
      value:
        (addresses?.length ?? 0) > 0
          ? `${addresses!.length} saved`
          : 'Add Home, Work, etc.',
      onPress: () => router.push('/(customer)/saved-addresses'),
    },
    {
      icon: 'card-outline',
      label: 'Payment methods',
      // Live count from usePaymentMethods so the value updates the moment
      // a card is saved / removed. Phase 3 will swap the storage to Stripe
      // tokenized methods; the row label stays the same.
      value:
        (cards?.length ?? 0) > 0
          ? `${cards!.length} saved card${cards!.length === 1 ? '' : 's'}`
          : 'Add a card',
      onPress: () => router.push('/(customer)/payment-methods'),
    },
    {
      icon: 'receipt-outline',
      label: 'Move history',
      // Deep-link to the Completed chip on the Moves screen so the customer
      // lands directly on their finished moves instead of the default
      // Upcoming view. ?tab=completed is read by useLocalSearchParams in
      // bookings.tsx and seeds the initial chip.
      onPress: () => router.push('/(customer)/bookings?tab=completed'),
    },
    {
      // Dedicated PDF-receipts surface. Movvy doesn't email receipts; this
      // screen lists every completed move with a one-tap "View / Save PDF"
      // button. Accountants asked for real PDFs, not emails — this is where
      // they live, always available, never bouncing in a spam folder.
      icon: 'document-text-outline',
      label: 'Receipts',
      value: 'View PDFs',
      onPress: () => router.push('/(customer)/receipts'),
    },
    // The "Referral code" + "Invite friends · $50 off" rows were pulled
    // pre-launch: the referral pipeline TRACKED credits (referrals table,
    // migration 0032 applies them on the friend's first booking) but nothing
    // ever redeemed them against a booking — bookings-create has no credit
    // logic, so the screen promised $50 that could never be spent. Restore
    // the rows (screen was app/(customer)/referrals.tsx, sheet was
    // components/PromoCodeSheet.tsx — both in git history) once redemption
    // is wired into the booking/invoice math.
  ];

  // Single "Customer service" entry replaces the old Help & support +
  // Emergency contact split. The support hub already bundles SOS, claims,
  // disputes, audit export, and the emergency-contact editor — so collapsing
  // both rows here makes the profile cleaner and keeps every safety/support
  // path one tap away.
  const support: Row[] = [
    {
      icon: 'headset-outline',
      label: 'Customer Service',
      value: 'Chat · SOS · claims · safety',
      onPress: () => router.push('/(customer)/support'),
    },
    {
      icon: 'document-text-outline',
      label: 'Terms & Privacy',
      onPress: () => Linking.openURL('https://movvy.ca/legal').catch(() => {
        toast.error("Couldn't open the legal page.");
      }),
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Profile" showBack={false} right={<NotificationBell />} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <MaxWidth>
        <Card>
          <View className="flex-row items-center">
            <Avatar name={displayName} size={64} />
            <View className="ml-4 flex-1">
              <Text className="text-xl font-bold text-ink-900">{displayName}</Text>
              <Text className="text-sm text-silver-500">{email}</Text>
              {profile?.email_verified_at ? (
                <View className="flex-row items-center mt-1">
                  <Ionicons name="shield-checkmark" size={12} color="#047857" />
                  <Text className="ml-1 text-xs text-brand-700 font-semibold">Email verified</Text>
                </View>
              ) : user ? (
                <Text className="text-xs text-warning mt-1 font-semibold">
                  Email pending verification
                </Text>
              ) : null}
            </View>
            {isLoading ? (
              <ActivityIndicator color="#71717A" />
            ) : (
              <Pressable
                onPress={() => setEditNameOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                hitSlop={6}
                className="h-10 w-10 rounded-full bg-silver-100 items-center justify-center active:opacity-70"
              >
                <Ionicons name="create-outline" size={18} color="#0A0A0A" />
              </Pressable>
            )}
          </View>
        </Card>

        {!supabaseConfigured ? (
          <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-4 flex-row">
            <Ionicons name="warning-outline" size={18} color="#F59E0B" />
            <Text className="ml-2 flex-1 text-xs text-ink-700 leading-5">
              Supabase keys aren't set yet. Profile data is empty until you add them to{' '}
              <Text className="font-bold">.env.local</Text>.
            </Text>
          </View>
        ) : null}

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Account
        </Text>
        <Card padded={false}>
          {account.map((r, i) => {
            const interactive = !r.staticRow && !!r.onPress;
            const RowComp: any = interactive ? Pressable : View;
            return (
              <RowComp
                key={r.label}
                onPress={interactive ? r.onPress : undefined}
                accessibilityRole={interactive ? 'button' : undefined}
                accessibilityLabel={r.label}
                className={`flex-row items-center px-5 py-4 ${
                  i < account.length - 1 ? 'border-b border-silver-100' : ''
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

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Support
        </Text>
        <Card padded={false}>
          {support.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              accessibilityRole="button"
              accessibilityLabel={r.label}
              className={`flex-row items-center px-5 py-4 ${
                i < support.length - 1 ? 'border-b border-silver-100' : ''
              } active:opacity-70`}
            >
              <Ionicons name={r.icon} size={20} color="#0A0A0A" />
              <View className="ml-3 flex-1">
                <Text className="text-base text-ink-900">{r.label}</Text>
                {r.value ? (
                  <Text className="text-xs text-silver-500 mt-0.5">{r.value}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
            </Pressable>
          ))}
        </Card>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Switch role
        </Text>
        {/* Single partner entry. /partner is the role-select hub where they
            pick Two-person crew vs Moving company — we deliberately don't
            split that decision into two rows here, so the profile stays
            tight and the partner-onboarding flow owns the role choice. */}
        <Card padded={false}>
          <Pressable
            onPress={() => router.push('/partner')}
            className="flex-row items-center px-5 py-4 active:opacity-70"
          >
            <View className="h-9 w-9 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="briefcase-outline" size={18} color="#047857" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">Become a Movvy Partner</Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                Two-person crew or moving company · earn on your own schedule
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
          </Pressable>
        </Card>

        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Legal
        </Text>
        <Card padded={false}>
          <Pressable
            onPress={() => router.push('/(legal)/terms')}
            className="flex-row items-center px-5 py-4 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Read the Terms of Service"
          >
            <Ionicons name="document-text-outline" size={20} color="#0A0A0A" />
            <View className="ml-3 flex-1">
              <Text className="text-base text-ink-900">Terms of Service</Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                The agreement you accepted at signup
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
          </Pressable>
          <Pressable
            onPress={() => router.push('/(legal)/terms')}
            className="flex-row items-center px-5 py-4 border-t border-silver-100 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Read the Privacy Policy"
          >
            <Ionicons name="shield-checkmark-outline" size={20} color="#0A0A0A" />
            <View className="ml-3 flex-1">
              <Text className="text-base text-ink-900">Privacy Policy</Text>
              <Text className="text-xs text-silver-500 mt-0.5">
                How Movvy handles your data
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
          </Pressable>
        </Card>

        <Pressable
          onPress={async () => {
            await logout();
            router.replace('/');
          }}
          className="mt-6 h-14 items-center justify-center rounded-2xl bg-white border border-silver-300 active:opacity-70"
        >
          <Text className="text-base font-semibold text-danger">Log out</Text>
        </Pressable>

        <Pressable
          onPress={() => setDeleteOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          className="mt-3 h-14 items-center justify-center rounded-2xl bg-white border border-silver-200 active:opacity-70"
        >
          <Text className="text-sm font-semibold text-silver-500">Delete my account</Text>
        </Pressable>

        <Text className="text-center text-xs text-silver-400 mt-6">Movvy v0.1.0 · Alberta-wide</Text>
        </MaxWidth>
      </ScrollView>

      {/* Editable account-row sheets. Each one is self-contained: it reads
          the latest profile via useProfile, applies the patch via
          useUpdateProfile, and dismisses itself on success. Emergency
          contact lives in the Customer Service hub now — it's a safety
          control, not a personal-info field. */}
      <EditNameSheet visible={editNameOpen} onClose={() => setEditNameOpen(false)} />
      <EditPhoneSheet visible={editPhoneOpen} onClose={() => setEditPhoneOpen(false)} />
      <DeleteAccountSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </SafeAreaView>
  );
}
