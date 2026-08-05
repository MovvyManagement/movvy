// =============================================================================
// PriceBreakdownView — customer-facing rate-card breakdown.
//
// Matches the model spelled out in src/lib/pricing.ts:
//   • Move time   = property hours × rate (matrix, bundles load + drive + unload)
//   • Travel      = HQ → pickup hours × rate (drive to get to the customer)
//   • Materials   = $50 flat
//   • Fuel        = $50 base + $25/half-hour above 60 min total drive
//   • GST         = 5%
//   • Estimate    = ceil(subtotal + gst, $1)
//
// pickup → dropoff drive is NOT shown as a separate line — it's bundled
// into the matrix "move time" + naturally captured by the actual timer.
// Insurance / packing-as-extra-hours used to live here; both removed
// from the model per founder direction.
// =============================================================================

import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fmtCurrency, fmtDuration } from '@/lib/format';
import type { PriceBreakdown as PB } from '@/lib/pricing';
import { COVERAGE_AMOUNT } from '@/lib/brand';

function Row({
  label,
  value,
  bold,
  sub,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <View className="flex-row justify-between py-2">
      <View className="flex-1 pr-3">
        <Text
          className={`${
            bold ? 'font-bold text-ink-900' : accent ? 'text-brand-700 font-semibold' : 'text-ink-700'
          } text-sm`}
        >
          {label}
        </Text>
        {sub ? <Text className="text-[11px] text-silver-400 mt-0.5">{sub}</Text> : null}
      </View>
      <Text
        className={`${
          bold ? 'font-bold text-ink-900' : accent ? 'text-brand-700 font-semibold' : 'text-ink-700'
        } text-sm`}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <Text className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-silver-400">
      {children}
    </Text>
  );
}

const cents = (c: number) => fmtCurrency(c / 100);
const rateLabel = (c: number) => `$${Math.round(c / 100)}/hr`;

export function PriceBreakdownView({ price }: { price: PB }) {
  return (
    <View>
      {/* Crew + rate summary */}
      <View className="rounded-2xl bg-silver-50 border border-silver-200 p-3 mb-2 flex-row items-center">
        <View className="h-10 w-10 rounded-xl bg-brand-50 items-center justify-center">
          <Ionicons name="people" size={18} color="#047857" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-sm font-bold text-ink-900">
            {price.recommendedCrew}-person crew · {rateLabel(price.hourlyRateCustomerCents)}
          </Text>
          <Text className="text-xs text-silver-500">
            {price.trucksIncluded === 0
              ? 'Labor only · no truck'
              : `${price.trucksIncluded} truck${price.trucksIncluded > 1 ? 's' : ''} included · billed for actual time on move day`}
          </Text>
        </View>
      </View>

      <SectionHeader>Estimate</SectionHeader>
      <Row
        label={`Move time · ${price.propertyHours}h × ${rateLabel(price.hourlyRateCustomerCents)}`}
        value={cents(price.serviceCostCents)}
        sub="Loading and unloading — typical for your property size"
      />
      <Row
        label={`Travel to your address · ${price.travelHours}h × ${rateLabel(price.hourlyRateCustomerCents)}`}
        value={cents(price.travelCostCents)}
        sub="Time for the crew to get from HQ to your pickup"
      />
      {price.isLongHaul ? (
        <Row
          label={`Transit · ${price.transportKm} km × $3.50/km`}
          value={cents(price.transitCents)}
          sub="Fixed for the distance — covers the drive, the fuel and the return, so traffic can't change your price"
        />
      ) : (
        <Row
          label={`Drive to drop-off · ${price.transportHours}h × ${rateLabel(price.hourlyRateCustomerCents)}`}
          value={cents(price.transportCostCents)}
          sub="Time on the road between your two addresses"
        />
      )}
      <Row
        label="Materials"
        value={cents(price.materialsCents)}
        sub="Flat rate · boxes, wrap, tape"
      />
      <Row
        label="Fuel"
        value={cents(price.longHaulCustomerCents)}
        sub="$50 base · +$25 per half-hour over 1 hr total drive"
      />

      <SectionHeader>Tax</SectionHeader>
      <Row label="GST (5%)" value={cents(price.gstCents)} />

      <View className="h-px bg-silver-200 my-2" />
      <Row label="Estimate" value={cents(price.totalCents)} bold />

      {/* Actual-time billing disclaimer */}
      <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row">
        <Ionicons name="information-circle-outline" size={18} color="#B45309" />
        <Text className="ml-2 flex-1 text-[11px] text-amber-900 leading-5">
          <Text className="font-bold">Estimate, not your final bill.</Text> Your crew
          starts a timer the moment they leave HQ and stops it the moment they
          finish your drop-off. You pay for the actual time at the same{' '}
          {rateLabel(price.hourlyRateCustomerCents)} rate — finish early, you
          pay less. {COVERAGE_AMOUNT} damage protection included.
        </Text>
      </View>
    </View>
  );
}
