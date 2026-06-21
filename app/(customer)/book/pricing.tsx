import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PriceBreakdownView } from '@/components/PriceBreakdown';
import { useBookingStore } from '@/store/bookingStore';
import { estimatePrice } from '@/lib/pricing';
import { fmtCurrency } from '@/lib/format';
import { COVERAGE_AMOUNT } from '@/lib/brand';

export default function PricingStep() {
  const draft = useBookingStore((s) => s.draft);
  const setPromoCode = useBookingStore((s) => s.setPromoCode);
  const [promo, setPromo] = useState(draft.promoCode ?? '');
  const price = useMemo(() => estimatePrice(draft), [draft]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={3} total={3} label="Pricing" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Text className="text-2xl font-bold text-ink-900 mt-2">Your estimate</Text>
        <Text className="mt-1 text-sm text-silver-500">
          Hourly billing on the actual time your crew is working — leaving
          HQ through finishing the drop-off.
        </Text>

        <View className="mt-5 rounded-3xl bg-ink-900 p-6">
          <Text className="text-white/70 text-xs font-semibold uppercase tracking-wider">
            Estimate
          </Text>
          <Text className="mt-1 text-white text-5xl font-bold">{fmtCurrency(price.totalCents / 100)}</Text>
          <Text className="mt-1 text-white/70 text-xs">
            {`${Math.round(price.hourlyRateCustomerCents / 100)}/hr · ${price.recommendedCrew}-person crew · GST included`}
          </Text>

          <View className="mt-4 flex-row items-center">
            <Ionicons name="shield-checkmark" size={16} color="#34D399" />
            <Text className="ml-2 text-white/80 text-xs">
              {`Damage protection included up to ${COVERAGE_AMOUNT}`}
            </Text>
          </View>
        </View>

        <View className="mt-5 rounded-3xl border border-silver-200 p-5">
          <Text className="text-base font-bold text-ink-900 mb-3">Breakdown</Text>
          <PriceBreakdownView price={price} />
        </View>

        <View className="mt-5">
          <Input
            label="Promo code"
            placeholder="Enter code"
            value={promo}
            onChangeText={setPromo}
            autoCapitalize="characters"
            leftIcon={<Ionicons name="pricetag-outline" size={18} color="#71717A" />}
            rightIcon={
              promo ? (
                <Pressable onPress={() => setPromoCode(promo)}>
                  <Text className="text-sm font-semibold text-brand-700">Apply</Text>
                </Pressable>
              ) : null
            }
          />
        </View>

        <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row">
          <Ionicons name="information-circle-outline" size={18} color="#71717A" />
          <Text className="ml-2 flex-1 text-xs text-silver-500 leading-5">
            Final price is set at the end of the move based on actual hours
            worked. If your crew finishes early you pay less; if it runs over,
            the extra hours are added.
          </Text>
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button
          label="Review & confirm"
          size="lg"
          fullWidth
          onPress={() => router.push('/(customer)/book/confirm')}
        />
      </View>
    </SafeAreaView>
  );
}
