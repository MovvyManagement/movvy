import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fmtCurrency, fmtDuration } from '@/lib/format';
import type { PriceBreakdown as PB } from '@/lib/pricing';

function Row({ label, value, bold, sub, accent }: { label: string; value: string; bold?: boolean; sub?: string; accent?: boolean }) {
  return (
    <View className="flex-row justify-between py-2">
      <View className="flex-1 pr-3">
        <Text className={`${bold ? 'font-bold text-ink-900' : accent ? 'text-brand-700 font-semibold' : 'text-ink-700'} text-sm`}>{label}</Text>
        {sub ? <Text className="text-[11px] text-silver-400 mt-0.5">{sub}</Text> : null}
      </View>
      <Text className={`${bold ? 'font-bold text-ink-900' : accent ? 'text-brand-700 font-semibold' : 'text-ink-700'} text-sm`}>{value}</Text>
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
              : `${price.trucksIncluded} truck${price.trucksIncluded > 1 ? 's' : ''} included · travel + on-site at the same rate`}
          </Text>
        </View>
      </View>

      <SectionHeader>Time</SectionHeader>
      <Row
        label="On-site work"
        value={fmtDuration(price.propertyHours * 60)}
        sub="Property-size estimate"
      />
      {price.packingHours > 0 ? <Row label="Packing service" value={fmtDuration(price.packingHours * 60)} /> : null}
      {price.additionalHours > 0 ? <Row label="Additional items" value={fmtDuration(price.additionalHours * 60)} /> : null}
      <Row
        label="Travel time"
        value={fmtDuration(price.travelHours * 60)}
        sub={price.intraCity ? 'Intra-city · 1 hr flat' : `HQ → pickup → drop-off · ~${price.routeKm.toFixed(0)} km`}
      />
      <View className="h-px bg-silver-200 my-1" />
      <Row
        label="Total billable time"
        value={fmtDuration(price.totalServiceHours * 60)}
        sub={
          price.minimumApplied
            ? `4-hour minimum applied · billed at ${rateLabel(price.hourlyRateCustomerCents)}`
            : `Billed at ${rateLabel(price.hourlyRateCustomerCents)}`
        }
        bold
      />

      <SectionHeader>Service</SectionHeader>
      <Row
        label="On-site cost"
        value={cents(price.serviceCostCents)}
        sub={`${price.billableOnSiteHours.toFixed(1)} hr × ${rateLabel(price.hourlyRateCustomerCents)}${price.minimumApplied ? ' · padded to 4-hr minimum' : ''}`}
      />
      <Row
        label="Travel cost"
        value={cents(price.travelCostCents)}
        sub={`${price.travelHours} hr × ${rateLabel(price.hourlyRateCustomerCents)}`}
      />

      <SectionHeader>Materials & add-ons</SectionHeader>
      <Row
        label="Packing materials"
        value={cents(price.materialsCents)}
        sub="Flat rate · boxes, wrap, tape"
      />
      {price.insuranceCents > 0 ? (
        <Row label="Moving insurance" value={cents(price.insuranceCents)} sub="Up to $2,500 protection" />
      ) : null}

      <SectionHeader>Tax</SectionHeader>
      <Row label="GST (5%)" value={cents(price.gstCents)} />

      <View className="h-px bg-silver-200 my-2" />
      <Row label="Estimated total" value={cents(price.totalCents)} bold />
      <Row
        label="Deposit due today (20%)"
        value={cents(price.depositCents)}
        accent
        sub="Non-refundable · subtracted from your final charge"
      />
      <Row
        label="Balance after move"
        value={cents(price.balanceDueOnCompletionCents)}
        sub="Captured when the job is marked complete"
      />

      {/* Estimate-may-change disclaimer */}
      <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row">
        <Ionicons name="information-circle-outline" size={18} color="#B45309" />
        <Text className="ml-2 flex-1 text-[11px] text-amber-900 leading-5">
          This is an <Text className="font-bold">estimate</Text>. The final charge can go up or down
          depending on how long the move actually takes. Hours are billed at the same{' '}
          {rateLabel(price.hourlyRateCustomerCents)} rate.
        </Text>
      </View>
    </View>
  );
}
