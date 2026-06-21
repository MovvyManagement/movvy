import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { useBookingStore } from '@/store/bookingStore';
import { estimatePrice, MOVE_TYPE_LABELS } from '@/lib/pricing';
import { fmtCurrency, fmtDateShort } from '@/lib/format';
import { useCreateBooking } from '@/lib/data';
import { useValidatePromo } from '@/lib/data/useAdmin';
import { Input } from '@/components/Input';
import { COVERAGE_LABEL, COVERAGE_AMOUNT } from '@/lib/brand';
import { track } from '@/lib/analytics';
import { supabaseConfigured } from '@/lib/supabase';
import { MaxWidth } from '@/components/MaxWidth';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// =============================================================================
// Pay-after-the-move flow (Phase 1).
//
// The deposit + saved-card picker that used to live on this screen has been
// removed — the customer commits to the booking now and Movvy invoices the
// final amount once the crew marks the job complete. When Stripe lands
// (Phase 3), reintroduce the payment-method picker + deposit charge here.
// =============================================================================

export default function ConfirmStep() {
  const draft = useBookingStore((s) => s.draft);
  const reset = useBookingStore((s) => s.reset);
  const setPromoCode = useBookingStore((s) => s.setPromoCode);
  const price = useMemo(() => estimatePrice(draft), [draft]);
  const createBooking = useCreateBooking();

  // Promo code — validates against the promo-validate edge fn. We don't
  // recompute price client-side; the server applies the discount when the
  // booking is created (promo_code is included in the createBooking body).
  // The UI just shows the "X% off" / "$Y off" preview.
  const [promoInput, setPromoInput] = useState(draft.promoCode ?? '');
  const [promoDiscountCents, setPromoDiscountCents] = useState<number | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const validatePromo = useValidatePromo();

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) {
      setPromoCode('');
      setPromoDiscountCents(null);
      setPromoError(null);
      return;
    }
    setPromoError(null);
    try {
      const res = await validatePromo.mutateAsync({
        code,
        subtotal_cents: price.taxableSubtotalCents,
        city_slug: draft.pickup?.city?.toLowerCase() ?? 'calgary',
      });
      if (!res.ok) {
        setPromoError(res.reason ?? "This code can't be used on this booking.");
        setPromoDiscountCents(null);
        setPromoCode('');
        return;
      }
      setPromoCode(code);
      setPromoDiscountCents(res.discount_cents ?? 0);
    } catch (e: any) {
      setPromoError(e?.message ?? "Couldn't check that code.");
      setPromoDiscountCents(null);
      setPromoCode('');
    }
  };

  const clearPromo = () => {
    setPromoInput('');
    setPromoCode('');
    setPromoDiscountCents(null);
    setPromoError(null);
  };

  const submit = async () => {
    if (!supabaseConfigured) {
      // Demo mode — Moves tab auto-renders the live tracker for active bookings
      reset();
      router.replace('/(customer)/bookings');
      return;
    }
    if (!draft.pickup || !draft.moveType || !draft.date) {
      Alert.alert('Missing details', 'Go back and complete every step.');
      return;
    }
    try {
      // City slug — derive from the pickup city name so cross-AB bookings
      // route to the right market. The server still re-validates the slug
      // against the cities table and snaps to the closest active city if
      // the bounds don't match — so a misspelt slug just falls back, no
      // booking is lost.
      const slugFromCity =
        (draft.pickup.city ?? '').trim().toLowerCase().replace(/\s+/g, '-') ||
        'calgary';
      const created = await createBooking.mutateAsync({
        city_slug: slugFromCity,
        pickup: {
          line1: draft.pickup.line1,
          city: draft.pickup.city,
          region: draft.pickup.province,
          country_code: 'CA',
          postal: draft.pickup.postal || undefined,
          lat: draft.pickup.lat ?? 0,
          lng: draft.pickup.lng ?? 0,
        },
        dropoff: draft.dropoff
          ? {
              line1: draft.dropoff.line1,
              city: draft.dropoff.city,
              region: draft.dropoff.province,
              country_code: 'CA',
              postal: draft.dropoff.postal || undefined,
              lat: draft.dropoff.lat ?? 0,
              lng: draft.dropoff.lng ?? 0,
            }
          : null,
        schedule: {
          mode: draft.scheduling ?? 'scheduled',
          date: draft.date,
          window: draft.timeWindow ?? 'Anytime',
        },
        details: { moveType: draft.moveType, ...(draft.details ?? {}) },
        customer_notes: draft.details?.notes,
        promo_code: draft.promoCode,
        // Client-side estimate as a hint. Server RECOMPUTES authoritatively.
        client_estimate_total_cents: price.totalCents,
      });
      reset();
      track('booking_created', {
        move_type: draft.moveType,
        total_cents: price.totalCents,
      });
      // Moves tab auto-detects the active booking and renders live tracking + chat.
      router.replace('/(customer)/bookings');
    } catch (e: any) {
      Alert.alert('Could not book', e?.message ?? 'Try again.');
    }
  };

  // SafeAreaView edges only include 'top' — the bottom CTA bar handles its
  // own safe-area padding so the button sits flush with the home-indicator
  // instead of floating above a white gap.
  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader />
        <StepIndicator step={3} total={3} label="Confirm" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 }}>
        <MaxWidth>
        <Text className="text-2xl font-bold text-ink-900">Review Your Move</Text>
        <Text className="mt-1 text-sm text-silver-500">Make sure everything looks right.</Text>

        {/* Locations */}
        <Card className="mt-5">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Locations
          </Text>
          <View className="flex-row">
            <View className="items-center mr-3">
              <View className="h-3 w-3 rounded-full bg-ink-900" />
              <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 20 }} />
              <View className="h-3 w-3 rounded-full bg-brand-600" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-ink-900">{draft.pickup?.line1 ?? '—'}</Text>
              <Text className="text-xs text-silver-500 mb-3">{draft.pickup?.city}</Text>
              <Text className="text-sm font-bold text-ink-900">{draft.dropoff?.line1 ?? '—'}</Text>
              <Text className="text-xs text-silver-500">{draft.dropoff?.city}</Text>
            </View>
          </View>
        </Card>

        {/* Schedule */}
        <Card className="mt-3">
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={20} color="#0A0A0A" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                {draft.date ? fmtDateShort(draft.date) : '—'}
              </Text>
              <Text className="text-xs text-silver-500">{draft.timeWindow}</Text>
            </View>
            <Pressable onPress={() => router.back()}>
              <Text className="text-sm font-semibold text-brand-700">Edit</Text>
            </Pressable>
          </View>
        </Card>

        {/* Details summary — type-aware */}
        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Move details
          </Text>
          <View className="gap-2">
            <Row k="Type" v={MOVE_TYPE_LABELS[draft.moveType ?? 'home_move']} />

            {draft.moveType === 'home_move' ? (
              <>
                {draft.details?.dwelling ? (
                  <Row k="Home" v={cap(draft.details.dwelling)} />
                ) : null}
                <Row
                  k="Rooms"
                  v={`${draft.details?.bedrooms ?? 0} bed · ${draft.details?.livingRooms ?? 0} living · ${draft.details?.bathrooms ?? 0} bath`}
                />
                <Row
                  k="Access"
                  v={`Floor ${draft.details?.floor ?? 1}${draft.details?.hasElevator ? ' · elevator' : ' · stairs'}`}
                />
              </>
            ) : null}

            {draft.moveType === 'commercial' ? (
              <>
                {draft.details?.commercialKind ? (
                  <Row k="Space" v={cap(draft.details.commercialKind)} />
                ) : null}
                {draft.details?.workstations !== undefined ? (
                  <Row k="Workstations" v={`${draft.details.workstations}`} />
                ) : null}
                {draft.details?.crewSize ? (
                  <Row
                    k="Crew"
                    v={`${draft.details.crewSize} movers · ${draft.details.estimatedHours ?? 0} hr`}
                  />
                ) : null}
              </>
            ) : null}

            {draft.moveType === 'single_items' ? (
              <>
                <Row
                  k="Items"
                  v={`${draft.details?.items?.reduce((a, i) => a + i.count, 0) ?? 0} total`}
                />
                {(draft.details?.stairsPickup ?? 0) + (draft.details?.stairsDropoff ?? 0) > 0 ? (
                  <Row
                    k="Stairs"
                    v={`${draft.details?.stairsPickup ?? 0} pickup · ${draft.details?.stairsDropoff ?? 0} dropoff`}
                  />
                ) : null}
              </>
            ) : null}

            {draft.moveType === 'labor_only' ? (
              <Row
                k="Crew"
                v={`${draft.details?.helpers ?? 0} helpers · ${draft.details?.estimatedHours ?? 0} hr`}
              />
            ) : null}
          </View>

          {draft.moveType === 'single_items' && draft.details?.items?.length ? (
            <View className="mt-3 flex-row flex-wrap gap-1.5">
              {draft.details.items.map((i) => (
                <Badge key={i.id} label={`${i.count}× ${i.label}`} tone="neutral" />
              ))}
            </View>
          ) : null}

          <View className="mt-3 flex-row flex-wrap gap-2">
            {draft.details?.packingNeeded ? <Badge label="Packing" tone="brand" /> : null}
            {draft.details?.assemblyNeeded ? <Badge label="Assembly" tone="brand" /> : null}
            {draft.details?.heavyItems ? <Badge label="Heavy items" tone="brand" /> : null}
            {draft.details?.fragileItems ? <Badge label="Fragile" tone="brand" /> : null}
          </View>
        </Card>

        {/* Pay-after-the-move banner — replaces the payment-method picker
            until Stripe lands. Sets the customer's expectation that no
            card is required upfront and the final number is invoiced
            after the crew completes the job. */}
        <Card className="mt-3">
          <View className="flex-row items-start">
            <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="cash-outline" size={20} color="#047857" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                Book now, pay after the move
              </Text>
              <Text className="mt-1 text-xs text-silver-500 leading-5">
                No card or deposit required to confirm. We'll send your invoice
                once the move wraps, charged on actual hours on site.
              </Text>
            </View>
          </View>
        </Card>

        {/* ─── Promo code — pre-estimate so the discount shows in the
            breakdown below if accepted. Backend validates against
            promo-validate; server reapplies on booking create. */}
        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
            Promo code
          </Text>
          {promoDiscountCents != null && promoDiscountCents >= 0 ? (
            <View className="flex-row items-center justify-between rounded-2xl bg-brand-50 border border-brand-100 px-3 py-2.5">
              <View className="flex-row items-center flex-1">
                <Ionicons name="pricetag" size={16} color="#047857" />
                <Text className="ml-2 text-sm font-bold text-ink-900">
                  {promoInput || draft.promoCode || 'Applied'}
                </Text>
                <Text className="ml-2 text-xs text-brand-700">
                  -{fmtCurrency(promoDiscountCents / 100)} off
                </Text>
              </View>
              <Pressable onPress={clearPromo} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#71717A" />
              </Pressable>
            </View>
          ) : (
            <View className="flex-row gap-2 items-end">
              <View className="flex-1">
                <Input
                  placeholder="Enter code (e.g. MOVE50)"
                  value={promoInput}
                  onChangeText={(t) => {
                    setPromoInput(t.toUpperCase());
                    if (promoError) setPromoError(null);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  error={promoError ?? undefined}
                  leftIcon={<Ionicons name="pricetag-outline" size={16} color="#71717A" />}
                />
              </View>
              <Pressable
                onPress={applyPromo}
                disabled={!promoInput.trim() || validatePromo.isPending}
                className={`h-[52px] px-4 rounded-2xl items-center justify-center ${
                  promoInput.trim() && !validatePromo.isPending
                    ? 'bg-ink-900 active:opacity-80'
                    : 'bg-silver-200'
                }`}
              >
                <Text className="text-sm font-bold text-white">
                  {validatePromo.isPending ? '…' : 'Apply'}
                </Text>
              </Pressable>
            </View>
          )}
        </Card>

        {/* ─── What's included — short, scannable bullet list ───────────── */}
        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            What's included
          </Text>
          {[
            { i: 'people-outline',           t: `${price.recommendedCrew}-person crew on site` },
            { i: 'car-outline',              t: 'Truck, fuel, and dollies' },
            { i: 'cube-outline',             t: 'Packing materials (boxes, wrap, tape)' },
            { i: 'construct-outline',        t: 'Assembly + disassembly of furniture' },
            { i: 'shield-checkmark-outline', t: `${COVERAGE_AMOUNT} damage coverage` },
          ].map((row, idx, arr) => (
            <View
              key={row.t}
              className={`flex-row items-center py-2 ${idx < arr.length - 1 ? 'border-b border-silver-100' : ''}`}
            >
              <Ionicons name={row.i as any} size={16} color="#047857" />
              <Text className="ml-3 flex-1 text-sm text-ink-900">{row.t}</Text>
              <Ionicons name="checkmark" size={14} color="#16A34A" />
            </View>
          ))}
        </Card>

        {/* ─── Estimate breakdown — every dollar line spelled out ───────── */}
        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-3">
            Estimate breakdown
          </Text>
          <PriceLine
            label={`Move time · ${price.billableOnSiteHours}h × $${(price.hourlyRateCustomerCents / 100).toFixed(0)}/hr`}
            value={fmtCurrency(price.serviceCostCents / 100)}
          />
          <PriceLine
            label={`Travel to your address · ${price.travelHours}h × $${(price.hourlyRateCustomerCents / 100).toFixed(0)}/hr`}
            value={fmtCurrency(price.travelCostCents / 100)}
          />
          <PriceLine
            label="Materials (boxes, wrap, tape)"
            value={fmtCurrency(price.materialsCents / 100)}
          />
          {/* Fuel — every move has a $50 base, longer drives add $25 per
              half-hour over the first hour. Always shown so customers
              never get a surprise fuel charge on the actual bill. */}
          <PriceLine
            label="Fuel"
            value={fmtCurrency(price.longHaulCustomerCents / 100)}
          />
          <PriceLine label="GST (5%)" value={fmtCurrency(price.gstCents / 100)} />
          <View className="h-px bg-silver-200 my-2" />
          <PriceLine
            label="Estimate"
            value={fmtCurrency(price.totalCents / 100)}
            bold
          />
          {/* Actual-time billing callout — this is the ESTIMATE, not the
              final bill. The crew starts a timer the moment they arrive at
              pickup (Begin Move) and stops it when they're done (Finish
              Move). Customer is billed for actual elapsed time × rate. */}
          <View className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3 flex-row items-start">
            <Ionicons name="time-outline" size={14} color="#92400E" />
            <Text className="ml-2 flex-1 text-[11px] text-amber-800 leading-4">
              <Text className="font-bold">Estimate, not the final bill.</Text> Your
              crew presses <Text className="font-bold">Begin Move</Text> when
              they arrive at your pickup, and <Text className="font-bold">Finish Move</Text> when
              the job's done. You pay for the actual time recorded — finish
              early, you pay less. Runs over, you pay more.
            </Text>
          </View>
        </Card>

        {/* Long-distance + insurance disclosures stay as their own cards so
            customers see them above the deposit CTA. */}
        {!price.intraCity && price.longHaulCustomerCents > 0 ? (
          <View className="mt-3 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row items-center">
            <View className="h-9 w-9 rounded-full bg-amber-500 items-center justify-center">
              <Ionicons name="trail-sign" size={18} color="#fff" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">Long-distance move</Text>
              <Text className="text-[11px] text-silver-600 mt-0.5 leading-4">
                {price.routeKm} km one-way · fuel + wear surcharge included above.
              </Text>
            </View>
          </View>
        ) : null}
        </MaxWidth>
      </ScrollView>

      {/* ─── Bottom CTA — pay-after-the-move ──────────────────────────────
          The headline is the estimated total (NOT a deposit). Nothing is
          charged here. The customer just commits the booking — billing
          happens after the crew marks the job complete. The big number
          is purposely the same one the estimate breakdown shows so the
          customer's expectation matches the screen above.
          Style note: bottom inset is handled here (paddingBottom 28) so
          the CTA hugs the home-indicator. */}
      <View
        className="px-5 pt-4 border-t border-silver-100 bg-white"
        style={{ paddingBottom: 28 }}
      >
        <View className="flex-row items-baseline justify-between">
          <Text className="text-xs font-bold uppercase tracking-wider text-silver-500">
            Estimated total
          </Text>
          <Text className="text-[11px] text-silver-500">Billed after move</Text>
        </View>
        <Text className="text-3xl font-bold text-ink-900 mt-0.5">
          {fmtCurrency(price.totalCents / 100)}
        </Text>
        <Text className="text-[11px] text-silver-500 mt-0.5">
          Final invoice based on actual hours on site — could be less if the
          crew finishes early, more if the job runs over.
        </Text>

        <View className="mt-3">
          <Button
            label="Book now · pay after"
            size="lg"
            fullWidth
            loading={createBooking.isPending}
            onPress={submit}
          />
        </View>
        <Text className="text-center text-[11px] text-silver-500 mt-2 leading-4 px-4">
          No card required. Cancel free up to 48 hours before your move.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-silver-500">{k}</Text>
      <Text className="text-sm font-semibold text-ink-900 capitalize">{v}</Text>
    </View>
  );
}

// One row of the estimate-breakdown. Bold variant is used for the subtotal
// so the running total stands out from the line items above it.
function PriceLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text
        className={`flex-1 text-sm ${bold ? 'font-bold text-ink-900' : 'text-silver-600'}`}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text className={`text-sm ${bold ? 'font-bold text-ink-900' : 'font-semibold text-ink-900'}`}>
        {value}
      </Text>
    </View>
  );
}
