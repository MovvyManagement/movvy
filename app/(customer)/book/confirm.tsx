import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Modal } from 'react-native';
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
import { haptic } from '@/lib/haptics';
import { PayMoveButton } from '@/components/PayMoveButton';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// =============================================================================
// Deposit-at-booking flow (2026-07-07).
//
// The customer pays a 20% deposit (of the estimate) right after the booking
// is created — the success takeover presents the Stripe Payment Sheet. The
// deposit is credited against the final bill and is refundable only when the
// move is cancelled more than 48 hours before its scheduled start.
// =============================================================================

const DEPOSIT_RATE = 0.20; // keep in sync with stripe-create-payment-intent

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

  // Booking-confirmed moment. Snapshotted at the instant the booking lands
  // (before reset() clears the draft) so the success takeover renders from
  // state, not the store. While non-null, a full-screen modal celebrates the
  // booking and spells out what happens next — the old flow silently dumped
  // the customer on the Moves list with no "did it work?" answer.
  const [confirmed, setConfirmed] = useState<{
    id: string | null;          // booking id — needed to charge the deposit
    code: string | null;
    date: string | null;
    window: string;
    totalCents: number;
  } | null>(null);
  const [depositPaid, setDepositPaid] = useState(false);

  // Every dismissal path (CTA, Android back) lands on the Moves tab — the
  // fresh booking is at the top of Upcoming, so the modal hands off to the
  // exact card the "arranging your crew" copy promised.
  const goToMoves = () => {
    setConfirmed(null);
    router.replace('/(customer)/bookings');
  };

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
      // Demo mode — same confirmed moment as the real flow, minus the
      // server-issued booking code.
      setConfirmed({
        id: null,
        code: null,
        date: draft.date ?? null,
        window: draft.timeWindow ?? 'Anytime',
        totalCents: price.totalCents,
      });
      reset();
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
      track('booking_created', {
        move_type: draft.moveType,
        total_cents: price.totalCents,
      });
      haptic.success();
      // Snapshot BEFORE reset() clears the draft — the confirmed takeover
      // renders from this state, not the store. Navigation to the Moves tab
      // now happens when the customer dismisses the modal (goToMoves).
      setConfirmed({
        id: created?.id ?? null,
        code: created?.short_code ?? null,
        date: draft.date ?? null,
        window: draft.timeWindow ?? 'Anytime',
        totalCents: price.totalCents,
      });
      reset();
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

          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {draft.details?.packingNeeded ? <Badge label="Packing" tone="brand" /> : null}
            {draft.details?.assemblyNeeded ? <Badge label="Assembly" tone="brand" /> : null}
            {draft.details?.heavyItems ? <Badge label="Heavy items" tone="brand" /> : null}
            {draft.details?.fragileItems ? <Badge label="Fragile" tone="brand" /> : null}
          </View>
        </Card>

        {/* How-payment-works banner — 20% deposit now, remainder billed on
            actual hours after the move. The deposit refund cutoff is spelled
            out HERE, before the customer commits, so it never surprises. */}
        <Card className="mt-3">
          <View className="flex-row items-start">
            <View className="h-10 w-10 rounded-2xl bg-brand-50 items-center justify-center">
              <Ionicons name="card-outline" size={20} color="#047857" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                {fmtCurrency(Math.round(price.totalCents * DEPOSIT_RATE) / 100)} deposit
                to lock it in
              </Text>
              <Text className="mt-1 text-xs text-silver-500 leading-5">
                20% of your estimate secures your crew and counts toward the
                final bill — you're only invoiced the rest after the move,
                based on actual hours. Fully refundable if you cancel more
                than 48 hours before your move; inside 48 hours it's
                non-refundable.
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

      {/* ─── Bottom CTA — book + 20% deposit ──────────────────────────────
          The headline stays the estimated total (the number the breakdown
          above promised); the sub-line spells out the deposit due right
          after booking. The deposit Payment Sheet is presented in the
          success takeover the moment the booking lands.
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
          <Text className="text-[11px] text-silver-500">
            {fmtCurrency(Math.round(price.totalCents * DEPOSIT_RATE) / 100)} deposit due now
          </Text>
        </View>
        <Text className="text-3xl font-bold text-ink-900 mt-0.5">
          {fmtCurrency(price.totalCents / 100)}
        </Text>
        <Text className="text-[11px] text-silver-500 mt-0.5">
          20% deposit today, credited to your final bill. The rest is billed
          on actual hours after the move — less if the crew finishes early,
          more if it runs over.
        </Text>

        <View className="mt-3">
          <Button
            label={`Book now · ${fmtCurrency(Math.round(price.totalCents * DEPOSIT_RATE) / 100)} deposit`}
            size="lg"
            fullWidth
            loading={createBooking.isPending}
            onPress={submit}
          />
        </View>
        <Text className="text-center text-[11px] text-silver-500 mt-2 leading-4 px-4">
          Deposit fully refundable until 48 hours before your move.
        </Text>
      </View>

      {/* ─── Booking-confirmed takeover ──────────────────────────────────
          The success moment at peak anxiety: big checkmark, the booking
          code, and the three things that happen next. No tap-outside
          dismiss — the single CTA (and Android back) both hand off to the
          Moves tab, where the fresh booking sits at the top of Upcoming. */}
      <Modal
        visible={!!confirmed}
        transparent
        animationType="fade"
        onRequestClose={goToMoves}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View className="rounded-3xl bg-white p-6">
            <View className="h-20 w-20 rounded-full bg-brand-600 items-center justify-center self-center">
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>
            <Text className="mt-4 text-2xl font-bold text-ink-900 text-center">
              {depositPaid || !confirmed?.id ? "You're booked!" : 'One last step'}
            </Text>
            <Text className="mt-1 text-sm text-silver-500 text-center">
              {confirmed?.code ? `Move #${confirmed.code}` : 'Booking confirmed'}
              {confirmed?.date ? ` · ${fmtDateShort(confirmed.date)}` : ''}
            </Text>
            {confirmed?.window ? (
              <Text className="text-sm text-silver-500 text-center">{confirmed.window}</Text>
            ) : null}

            <View className="mt-6 gap-3">
              <NextStep
                icon="card-outline"
                text={`Pay your ${fmtCurrency(
                  Math.round((confirmed?.totalCents ?? 0) * DEPOSIT_RATE) / 100,
                )} deposit below to lock in your crew — it counts toward your final bill.`}
              />
              <NextStep
                icon="people-outline"
                text="The crew search starts the moment your deposit is in — your crew appears on your move card when they confirm."
              />
              <NextStep
                icon="cash-outline"
                text={`The remaining balance of your ${fmtCurrency(
                  (confirmed?.totalCents ?? 0) / 100,
                )} estimate is billed on actual hours after the move. Deposit refundable until 48h before.`}
              />
            </View>

            {/* Deposit payment — the modal's primary action. Real bookings
                have an id; demo mode (no backend) skips straight to Moves. */}
            {confirmed?.id ? (
              <View className="mt-6">
                <PayMoveButton
                  bookingId={confirmed.id}
                  amountDollars={Math.round((confirmed.totalCents ?? 0) * DEPOSIT_RATE) / 100}
                  kind="deposit"
                  onPaid={() => setDepositPaid(true)}
                />
              </View>
            ) : null}

            <Pressable
              onPress={goToMoves}
              className={`mt-3 h-14 rounded-2xl items-center justify-center active:opacity-90 ${
                depositPaid || !confirmed?.id ? 'bg-brand-600' : 'bg-white border border-silver-300'
              }`}
              accessibilityRole="button"
              accessibilityLabel="Track your move in My Moves"
            >
              <Text
                className={`text-base font-bold ${
                  depositPaid || !confirmed?.id ? 'text-white' : 'text-ink-700'
                }`}
              >
                {depositPaid || !confirmed?.id ? 'Track it in My Moves' : 'Not now — my move stays on hold'}
              </Text>
            </Pressable>
            {!depositPaid && confirmed?.id ? (
              <Text className="mt-2 text-[11px] text-silver-500 text-center leading-4">
                Your booking is saved but NOT sent to crews until the deposit is
                paid. You can pay any time from My Moves.
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
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

// One "what happens next" row inside the booking-confirmed takeover.
function NextStep({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-start">
      <View className="h-8 w-8 rounded-full bg-brand-50 items-center justify-center mt-0.5">
        <Ionicons name={icon} size={16} color="#047857" />
      </View>
      <Text className="ml-3 flex-1 text-sm text-ink-700 leading-5">{text}</Text>
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
