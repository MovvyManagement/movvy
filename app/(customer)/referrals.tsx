// =============================================================================
// /(customer)/referrals — invite a friend to move with Movvy.
//
// $75 each side, paid when the person you invited BOOKS AND PAYS for their
// first move. Not on signup, and not on the booking being created — a booking
// is a draft until the deposit is captured, and paying out on drafts would mean
// paying for abandoned checkouts.
//
// There was no customer-facing referral screen at all before this: customers
// had a referral code on their profile row that nothing in the app ever showed
// them.
// =============================================================================

import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { MaxWidth } from '@/components/MaxWidth';
import { ReferralPanel } from '@/components/ReferralPanel';

export default function CustomerReferrals() {
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Invite a friend" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <MaxWidth>
          <ReferralPanel side="customer" />
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
